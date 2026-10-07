/**
 * Instagram Cookie & Proxy Manager
 *
 * Manages a pool of Instagram session cookies and optional proxy list.
 * Cookies are loaded from:
 *   1. INSTAGRAM_COOKIES env variable (highest priority)
 *   2. ig-cookies.json file in the api-server root
 *
 * Proxies are loaded from ig-proxies.json.
 *
 * Cookie health tracking:
 *   - Each cookie tracks consecutive failures
 *   - After MAX_FAIL_COUNT failures it is soft-blocked for HEAL_AFTER_MS
 *   - After the cooldown it is automatically re-tried (self-healing)
 */

import fs from "fs";
import path from "path";
import os from "os";

// ── Constants ─────────────────────────────────────────────────────────────────
const COOKIES_FILE    = path.join(process.cwd(), "ig-cookies.json");
const PROXIES_FILE    = path.join(process.cwd(), "ig-proxies.json");
const COOKIE_DIR      = path.join(os.tmpdir(), "fvd-cookies");
const MAX_FAIL_COUNT  = 3;                   // block after 3 consecutive failures
const HEAL_AFTER_MS   = 30 * 60 * 1000;     // re-try a blocked cookie after 30 min
const RELOAD_EVERY_MS = 5  * 60 * 1000;     // re-read config files every 5 min

if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawCookieEntry {
  id: string;
  description?: string;
  cookie_string: string;
  active?: boolean;
}

interface PoolEntry extends RawCookieEntry {
  failCount:    number;
  blockedAt:    string | null;
  active:       boolean;
  /** If set, toCookieFile() returns this path directly (for cookies.txt files). */
  rawFilePath?: string;
}

// ── Instagram Cookie Manager ──────────────────────────────────────────────────
export class InstagramCookieManager {
  private pool:    PoolEntry[]          = [];
  private cursor:  number               = 0;
  private cache:   Map<string, string>  = new Map(); // cookie id → temp file path

  constructor() {
    this.load();
    // Periodically reload so the admin can hot-add cookies without restart
    setInterval(() => this.load(), RELOAD_EVERY_MS);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  load(): void {
    const fresh: PoolEntry[] = [];

    // 1. INSTAGRAM_SESSION_ID — simplest env var, just the raw sessionid value
    const sessionIdRaw = process.env.INSTAGRAM_SESSION_ID?.trim();
    if (sessionIdRaw) {
      fresh.push(this.makeEntry({
        id:            "__env_sessionid__",
        description:   "INSTAGRAM_SESSION_ID env var",
        cookie_string: sessionIdRaw.startsWith("sessionid=") ? sessionIdRaw : `sessionid=${sessionIdRaw}`,
        active:        true,
      }));
    }

    // 2. INSTAGRAM_COOKIES — full cookie string (sessionid=X; csrftoken=Y; ...)
    const envRaw = process.env.INSTAGRAM_COOKIES?.trim();
    if (envRaw) {
      fresh.push(this.makeEntry({
        id:            "__env__",
        description:   "INSTAGRAM_COOKIES env var",
        cookie_string: envRaw,
        active:        true,
      }));
    }

    // 3. INSTAGRAM_COOKIES_FILE — path to an existing Netscape-format cookies.txt
    const cookiesFilePath = process.env.INSTAGRAM_COOKIES_FILE?.trim();
    if (cookiesFilePath && fs.existsSync(cookiesFilePath)) {
      const entry = this.makeEntry({
        id:            "__env_file__",
        description:   "INSTAGRAM_COOKIES_FILE env var",
        cookie_string: "__file__",
        active:        true,
      });
      entry.rawFilePath = cookiesFilePath;
      fresh.push(entry);
    }

    // 4. ig-cookies.json
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8")) as { cookies?: RawCookieEntry[] };
        for (const raw of data.cookies ?? []) {
          // Skip placeholder / empty entries
          if (!raw.cookie_string?.trim() || raw.cookie_string.includes("YOUR_SESSION_ID")) continue;
          fresh.push(this.makeEntry(raw));
        }
      } catch (err) {
        console.error("[CookieMgr] Failed to parse ig-cookies.json:", err);
      }
    }

    // Preserve health state from previous load
    for (const entry of fresh) {
      const existing = this.pool.find(e => e.id === entry.id);
      if (existing) {
        entry.failCount = existing.failCount;
        entry.blockedAt = existing.blockedAt;
      }
    }

    this.pool = fresh;

    const total  = this.pool.length;
    const active = this.activeCount;
    console.log(`[CookieMgr] Loaded ${total} cookie(s) — ${active} active`);
  }

  private makeEntry(raw: RawCookieEntry): PoolEntry {
    return {
      id:            raw.id,
      description:   raw.description ?? "",
      cookie_string: raw.cookie_string.trim(),
      active:        raw.active !== false,
      failCount:     0,
      blockedAt:     null,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns the next usable cookie entry (round-robin, skips blocked ones).
   * Returns null when no cookies are configured or all are blocked.
   */
  getNext(): PoolEntry | null {
    if (this.pool.length === 0) return null;

    const now = Date.now();
    const usable = this.pool.filter(e => {
      if (!e.active) return false;
      if (e.failCount < MAX_FAIL_COUNT) return true;
      // Auto-heal: cooldown passed → reset and re-admit
      if (e.blockedAt && now - new Date(e.blockedAt).getTime() > HEAL_AFTER_MS) {
        e.failCount = 0;
        e.blockedAt = null;
        console.log(`[CookieMgr] Cookie "${e.id}" healed after cooldown`);
        return true;
      }
      return false;
    });

    if (usable.length === 0) return null;

    const entry = usable[this.cursor % usable.length];
    this.cursor = (this.cursor + 1) % usable.length;
    return entry;
  }

  /**
   * Mark a cookie as having failed (e.g. got 403).
   * After MAX_FAIL_COUNT failures it is soft-blocked for 30 min.
   */
  markFailed(id: string): void {
    const e = this.pool.find(c => c.id === id);
    if (!e) return;
    e.failCount++;
    if (e.failCount >= MAX_FAIL_COUNT && !e.blockedAt) {
      e.blockedAt = new Date().toISOString();
      console.warn(`[CookieMgr] Cookie "${id}" blocked after ${MAX_FAIL_COUNT} failures — will heal in 30 min`);
    }
  }

  /** Reset failure counter when a cookie succeeds. */
  markSuccess(id: string): void {
    const e = this.pool.find(c => c.id === id);
    if (!e) return;
    if (e.failCount > 0) {
      e.failCount = 0;
      e.blockedAt = null;
    }
  }

  /**
   * Write a cookie entry to a Netscape-format cookie file and cache the path.
   * Returns the file path to pass to yt-dlp via --cookies.
   * For entries sourced from INSTAGRAM_COOKIES_FILE the original file is returned directly.
   */
  toCookieFile(entry: PoolEntry): string {
    if (entry.rawFilePath && fs.existsSync(entry.rawFilePath)) return entry.rawFilePath;

    const cached = this.cache.get(entry.id);
    if (cached && fs.existsSync(cached)) return cached;

    let s = entry.cookie_string;
    if (s.includes("%3A") || s.includes("%3D")) s = decodeURIComponent(s);
    if (!s.includes("=")) s = `sessionid=${s}`;

    const safeId  = entry.id.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
    const outPath = path.join(COOKIE_DIR, `ig_${safeId}.txt`);
    const lines   = ["# Netscape HTTP Cookie File", ""];

    for (const pair of s.split(";").map(p => p.trim()).filter(Boolean)) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name  = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && value) {
        lines.push(`.instagram.com\tTRUE\t/\tFALSE\t9999999999\t${name}\t${value}`);
      }
    }

    fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
    this.cache.set(entry.id, outPath);
    return outPath;
  }

  /** Extract the raw sessionid value (used by instaloader --sessionid). */
  getSessionId(entry: PoolEntry): string | null {
    let s = entry.cookie_string;
    if (s.includes("%3A") || s.includes("%3D")) s = decodeURIComponent(s);
    const m = s.match(/sessionid=([^;]+)/i);
    return m?.[1] ?? null;
  }

  // ── Status ────────────────────────────────────────────────────────────────

  get size(): number { return this.pool.length; }

  get activeCount(): number {
    return this.pool.filter(e => e.active && e.failCount < MAX_FAIL_COUNT).length;
  }

  /** Status report for the /instagram-status endpoint. */
  statusReport(): object {
    return {
      total:  this.pool.length,
      active: this.activeCount,
      cookies: this.pool.map(e => ({
        id:          e.id,
        description: e.description,
        active:      e.active && e.failCount < MAX_FAIL_COUNT,
        failCount:   e.failCount,
        blockedAt:   e.blockedAt,
      })),
    };
  }
}

// ── Proxy Manager ─────────────────────────────────────────────────────────────
export class ProxyManager {
  private list:   string[] = [];
  private cursor: number   = 0;

  constructor() {
    this.load();
    setInterval(() => this.load(), RELOAD_EVERY_MS);
  }

  private load(): void {
    if (!fs.existsSync(PROXIES_FILE)) { this.list = []; return; }
    try {
      const data = JSON.parse(fs.readFileSync(PROXIES_FILE, "utf8")) as { proxies?: unknown[] };
      this.list = (data.proxies ?? [])
        .filter((p): p is string =>
          typeof p === "string" &&
          (p.startsWith("http://") || p.startsWith("https://") || p.startsWith("socks5://")) &&
          !p.includes("PROXY_HOST")
        );
      if (this.list.length > 0) {
        console.log(`[ProxyMgr] Loaded ${this.list.length} proxy(ies)`);
      }
    } catch (err) {
      console.error("[ProxyMgr] Failed to parse ig-proxies.json:", err);
      this.list = [];
    }
  }

  /** Returns the next proxy URL, or null if none are configured. */
  getNext(): string | null {
    if (this.list.length === 0) return null;
    const proxy = this.list[this.cursor % this.list.length];
    this.cursor = (this.cursor + 1) % this.list.length;
    return proxy;
  }

  get hasProxies(): boolean { return this.list.length > 0; }
  get count():      number  { return this.list.length; }
}

// ── Singleton instances (shared across all route handlers) ───────────────────
export const igCookies = new InstagramCookieManager();
export const igProxies = new ProxyManager();
