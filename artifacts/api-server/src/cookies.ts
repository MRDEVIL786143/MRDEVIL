/**
 * cookies.ts — Platform cookie provider for yt-dlp.
 *
 * Datacenter IPs (Railway etc.) frequently get "Sign in to confirm you're not
 * a bot" walls from YouTube and login walls elsewhere. Sending cookies from a
 * real logged-in session dramatically raises success rates.
 *
 * Supported sources per platform (checked in this order):
 *   1. <P>_COOKIES       — cookie header string ("k=v; k2=v2") OR full
 *                          Netscape-format cookies.txt content (multiline)
 *   2. <P>_COOKIES_URL   — URL serving a cookies.txt (host on a private gist /
 *                          S3 / anywhere). Perfect for Railway where files
 *                          can't be uploaded easily. Re-fetched every
 *                          COOKIES_REFRESH_MS.
 *   3. <P>_COOKIES_FILE  — path to a Netscape cookies.txt inside the container
 *
 * Platforms: YOUTUBE, TIKTOK, INSTAGRAM, FACEBOOK, TWITTER, REDDIT, VIMEO,
 *            PINTEREST, GENERIC (catch-all applied to unlisted platforms)
 *
 * cookieArgsFor(platformKey) returns yt-dlp args like ["--cookies", "/tmp/..."]
 * or [] when nothing is configured for that platform.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { proxiedGet } from "./proxy-pool.js";

const COOKIE_DIR = path.join(os.tmpdir(), "fvd-cookies");
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });

const COOKIES_REFRESH_MS = Number(process.env.COOKIES_REFRESH_HOURS ?? 6) * 3600_000;

export type PlatformKey =
  | "youtube" | "tiktok" | "instagram" | "facebook" | "twitter"
  | "reddit" | "vimeo" | "pinterest" | "generic";

const PLATFORMS: PlatformKey[] = [
  "youtube", "tiktok", "instagram", "facebook", "twitter",
  "reddit", "vimeo", "pinterest", "generic",
];

interface CookieSource {
  value: string;
  isUrl: boolean;
  fetchedAt: number;
}

const cache = new Map<PlatformKey, CookieSource>();

/** Map a full video URL to its platform key (mirrors detectPlatform in video.ts). */
export function platformKeyFor(url: string): PlatformKey {
  const l = url.toLowerCase();
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "youtube";
  if (l.includes("tiktok.com"))                          return "tiktok";
  if (l.includes("instagram.com"))                       return "instagram";
  if (l.includes("facebook.com") || l.includes("fb.watch")) return "facebook";
  if (l.includes("twitter.com") || l.includes("x.com"))  return "twitter";
  if (l.includes("reddit.com") || l.includes("redd.it")) return "reddit";
  if (l.includes("vimeo.com"))                           return "vimeo";
  if (l.includes("pinterest.com") || l.includes("pin.it")) return "pinterest";
  return "generic";
}

/** Convert a cookie header string into Netscape format for a given domain. */
function headerToNetscape(header: string, domain: string): string {
  let s = header.trim();
  // URL-encoded cookies (%3D etc.) → decode once
  if (s.includes("%3A") || s.includes("%3D") || s.includes("%2F")) {
    try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  }
  const lines = ["# Netscape HTTP Cookie File", ""];
  for (const pair of s.split(";").map(p => p.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // HttpOnly-style prefixes (e.g. "__Host-") need Secure; keep it simple:
    const secure = name.startsWith("__Host-") || name.startsWith("__Secure-");
    lines.push(`${domain}\tTRUE\t/\t${secure ? "TRUE" : "FALSE"}\t2147483647\t${name}\t${value}`);
  }
  return lines.join("\n") + "\n";
}

/** Detect whether raw content is already Netscape format. */
function isNetscapeFormat(raw: string): boolean {
  return raw.includes("\t") && /^(#.*)?[\w.]+\t/m.test(raw);
}

function domainForPlatform(p: PlatformKey): string {
  switch (p) {
    case "youtube":   return ".youtube.com";
    case "tiktok":    return ".tiktok.com";
    case "instagram": return ".instagram.com";
    case "facebook":  return ".facebook.com";
    case "twitter":   return ".twitter.com";
    case "reddit":    return ".reddit.com";
    case "vimeo":     return ".vimeo.com";
    case "pinterest": return ".pinterest.com";
    default:          return ".example.com";
  }
}

async function fetchCookiesFromUrl(url: string): Promise<string | null> {
  try {
    const res = await proxiedGet(url, { timeoutMs: 15_000, maxRedirects: 3 });
    if (res.status !== 200 || !res.body) {
      console.warn(`[Cookies] URL fetch for cookies returned HTTP ${res.status}`);
      return null;
    }
    return res.body;
  } catch (err) {
    console.warn(`[Cookies] failed to fetch cookies from URL: ${(err as Error).message}`);
    return null;
  }
}

/** Resolve the raw cookie content for a platform (with URL refresh support). */
async function resolveRaw(p: PlatformKey): Promise<string | null> {
  const P = p.toUpperCase();

  // 1. Env string (header format or inline Netscape)
  const envVal = process.env[`${P}_COOKIES`]?.trim();
  if (envVal) return envVal;

  // 2. URL — with periodic refresh
  const url = process.env[`${P}_COOKIES_URL`]?.trim();
  if (url) {
    const cachedEntry = cache.get(p);
    if (cachedEntry?.isUrl && Date.now() - cachedEntry.fetchedAt < COOKIES_REFRESH_MS) {
      return cachedEntry.value;
    }
    const fresh = await fetchCookiesFromUrl(url);
    if (fresh) {
      cache.set(p, { value: fresh, isUrl: true, fetchedAt: Date.now() });
      console.log(`[Cookies] ${p}: loaded cookies from URL (${Buffer.byteLength(fresh)} bytes)`);
      return fresh;
    }
    if (cachedEntry) return cachedEntry.value; // stale-but-better-than-nothing
    return null;
  }

  // 3. File path
  const file = process.env[`${P}_COOKIES_FILE`]?.trim();
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8");

  return null;
}

/**
 * Returns yt-dlp args for the given platform, e.g. ["--cookies", "/tmp/fvd-cookies/youtube.txt"].
 * Empty array when no cookies are configured (callers go cookie-less).
 */
export async function cookieArgsFor(p: PlatformKey): Promise<string[]> {
  try {
    const raw = await resolveRaw(p);
    if (!raw) return [];

    const content = isNetscapeFormat(raw)
      ? raw
      : headerToNetscape(raw, domainForPlatform(p));

    const safe = `ck_${p}.txt`;
    const out = path.join(COOKIE_DIR, safe);
    fs.writeFileSync(out, content, "utf8");
    return ["--cookies", out];
  } catch (err) {
    console.warn(`[Cookies] ${p}: ${(err as Error).message}`);
    return [];
  }
}

/** Quick status for diagnostics endpoint. */
export function cookiesStatus() {
  return PLATFORMS.map(p => {
    const P = p.toUpperCase();
    return {
      platform: p,
      envCookies: Boolean(process.env[`${P}_COOKIES`]),
      cookiesUrl: Boolean(process.env[`${P}_COOKIES_URL`]),
      cookiesFile: Boolean(process.env[`${P}_COOKIES_FILE`] && fs.existsSync(process.env[`${P}_COOKIES_FILE`]!.trim())),
      cached: cache.has(p),
    };
  });
}
