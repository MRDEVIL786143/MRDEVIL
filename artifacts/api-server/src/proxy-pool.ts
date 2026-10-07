/**
 * proxy-pool.ts — Global rotating proxy manager with health tracking.
 *
 * One pool shared by ALL platforms (YouTube, TikTok, Instagram, Facebook,
 * Twitter, Reddit, Vimeo, Pinterest, generic). Railway/datacenter IPs are
 * actively blocked by most platforms, so production deployments should plug
 * in residential proxies and let this pool rotate them.
 *
 * Sources (merged, deduped, order preserved):
 *   1. PROXIES / PROXY_LIST  — comma-separated proxy URLs (global)
 *   2. PROXY_URL             — single proxy (alias)
 *   3. TIKTOK_PROXIES / TIKTOK_PROXY — legacy per-platform vars (still global here)
 *   4. ig-proxies.json file  — legacy file compat ({ "proxies": [...] })
 *
 * Health tracking:
 *   - Consecutive failures soft-block a proxy for PROXY_COOLDOWN_MS (5 min default)
 *   - Blocked proxies auto-heal and are re-tried
 *   - Selection prefers healthy proxies (weighted round-robin)
 *
 * Also exports proxiedFetch() so server-side HTML scraping (TikTok webpage
 * provider) goes through the same pool instead of leaking the server IP.
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import zlib from "zlib";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const RELOAD_EVERY_MS = 5 * 60 * 1000;
const MAX_CONSEC_FAILS = Number(process.env.PROXY_MAX_FAILS ?? 3);
const COOLDOWN_MS = Number(process.env.PROXY_COOLDOWN_MS ?? 5 * 60 * 1000);

interface ProxyEntry {
  url: string;
  failStreak: number;
  successCount: number;
  failCount: number;
  blockedAt: number | null;
  lastUsedAt: number;
  lastError: string | null;
}

function parseProxyList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s) || /^socks(4|4a|5|h)?:\/\//i.test(s));
}

export class ProxyPool {
  private entries: ProxyEntry[] = [];
  private cursor = 0;

  constructor() {
    this.load();
    setInterval(() => this.load(), RELOAD_EVERY_MS).unref();
  }

  load(): void {
    const urls: string[] = [
      ...parseProxyList(process.env.PROXIES),
      ...parseProxyList(process.env.PROXY_LIST),
      ...parseProxyList(process.env.PROXY_URL),
      ...parseProxyList(process.env.TIKTOK_PROXIES),
      ...parseProxyList(process.env.TIKTOK_PROXY),
    ];

    // Legacy file compat: artifacts/api-server/ig-proxies.json
    try {
      const file = path.join(process.cwd(), "ig-proxies.json");
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8")) as { proxies?: unknown[] };
        for (const p of data.proxies ?? []) {
          if (typeof p === "string" && !p.includes("PROXY_HOST")) urls.push(p);
        }
      }
    } catch { /* ignore malformed file */ }

    // Dedupe, preserve order
    const seen = new Set<string>();
    const fresh: ProxyEntry[] = [];
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const existing = this.entries.find(e => e.url === url);
      fresh.push(existing ?? {
        url,
        failStreak: 0,
        successCount: 0,
        failCount: 0,
        blockedAt: null,
        lastUsedAt: 0,
        lastError: null,
      });
    }

    this.entries = fresh;
    if (fresh.length > 0) {
      console.log(`[ProxyPool] ${fresh.length} proxy(ies) loaded — rotation active for all platforms`);
    }
  }

  private isUsable(e: ProxyEntry, now: number): boolean {
    if (e.failStreak < MAX_CONSEC_FAILS) return true;
    if (e.blockedAt && now - e.blockedAt > COOLDOWN_MS) {
      console.log(`[ProxyPool] proxy ...${e.url.slice(-18)} healed after cooldown`);
      e.failStreak = 0;
      e.blockedAt = null;
      return true;
    }
    return false;
  }

  /**
   * Pick the next healthy proxy (round-robin among usable ones).
   * Returns null when no proxies are configured — callers then go direct.
   */
  getNext(): string | null {
    if (this.entries.length === 0) return null;
    const now = Date.now();
    const usable = this.entries.filter(e => this.isUsable(e, now));
    if (usable.length === 0) {
      // Everything is cooling down — retry the least-recently-failed one anyway
      const oldest = [...this.entries].sort((a, b) => (a.blockedAt ?? 0) - (b.blockedAt ?? 0))[0];
      return oldest?.url ?? null;
    }
    const proxy = usable[this.cursor % usable.length];
    this.cursor = (this.cursor + 1) % usable.length;
    proxy.lastUsedAt = now;
    return proxy.url;
  }

  reportSuccess(url: string): void {
    const e = this.entries.find(x => x.url === url);
    if (!e) return;
    e.successCount++;
    e.failStreak = 0;
    e.blockedAt = null;
  }

  reportFailure(url: string, err?: string): void {
    const e = this.entries.find(x => x.url === url);
    if (!e) return;
    e.failCount++;
    e.failStreak++;
    e.lastError = err?.slice(0, 160) ?? null;
    if (e.failStreak >= MAX_CONSEC_FAILS && !e.blockedAt) {
      e.blockedAt = Date.now();
      console.warn(`[ProxyPool] proxy ...${url.slice(-18)} blocked for ${Math.round(COOLDOWN_MS / 1000)}s after ${e.failStreak} failures`);
    }
  }

  get count(): number { return this.entries.length; }
  get hasProxies(): boolean { return this.entries.length > 0; }

  healthyCount(): number {
    const now = Date.now();
    return this.entries.filter(e => this.isUsable(e, now)).length;
  }

  statusReport() {
    return {
      configured: this.entries.length,
      healthy: this.healthyCount(),
      cooldownMs: COOLDOWN_MS,
      proxies: this.entries.map(e => ({
        endpoint: e.url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@"),
        healthy: e.failStreak < MAX_CONSEC_FAILS,
        successCount: e.successCount,
        failCount: e.failCount,
        lastError: e.lastError,
      })),
    };
  }
}

// ── Agent helper ──────────────────────────────────────────────────────────────
const agentCache = new Map<string, https.Agent | http.Agent>();

export function agentFor(proxyUrl: string): https.Agent | http.Agent | undefined {
  if (!proxyUrl) return undefined;
  const cached = agentCache.get(proxyUrl);
  if (cached) return cached;
  let agent: https.Agent | http.Agent;
  try {
    agent = /^socks/i.test(proxyUrl)
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    console.warn(`[ProxyPool] bad proxy URL: ${(err as Error).message}`);
    return undefined;
  }
  if (agentCache.size > 200) agentCache.clear();
  agentCache.set(proxyUrl, agent);
  return agent;
}

// ── Proxied HTTP(S) GET with decompression ────────────────────────────────────
export interface ProxiedGetResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** Followed redirect chain (final URL fetched). */
  finalUrl: string;
}

export function proxiedGet(
  targetUrl: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    proxyUrl?: string | null;
    maxRedirects?: number;
  } = {},
): Promise<ProxiedGetResult> {
  const { headers = {}, timeoutMs = 15_000, proxyUrl = null, maxRedirects = 4 } = opts;

  const fetchOnce = (url: string, redirectsLeft: number): Promise<ProxiedGetResult> =>
    new Promise((resolve, reject) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch { reject(new Error(`Invalid URL: ${url}`)); return; }
      const lib = parsed.protocol === "https:" ? https : http;
      const agent = proxyUrl ? agentFor(proxyUrl) : undefined;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers,
          ...(agent ? { agent } : {}),
        },
        res => {
          const loc = res.headers.location;
          if (loc && res.statusCode! >= 300 && res.statusCode! < 400 && redirectsLeft > 0) {
            res.resume();
            const next = loc.startsWith("http") ? loc : `${parsed.origin}${loc}`;
            resolve(fetchOnce(next, redirectsLeft - 1));
            return;
          }
          const enc = (res.headers["content-encoding"] ?? "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
          else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
          else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8"), finalUrl: url }),
          );
          stream.on("error", reject);
        },
      );
      req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
      req.on("error", reject);
      req.end();
    });

  return fetchOnce(targetUrl, maxRedirects);
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const proxyPool = new ProxyPool();
