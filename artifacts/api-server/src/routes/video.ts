/**
 * video.ts — MR DEVIL VIDEO DOWNLOADER API (Railway-hardened edition)
 *
 * Why downloads fail on Railway: the app egresses from datacenter IPs that
 * YouTube ("Sign in to confirm you're not a bot"), TikTok (captcha) and
 * Instagram (login wall) actively block. This version fixes that with:
 *
 *  • Global proxy pool (PROXIES env) — rotated for ALL platforms, with health
 *    tracking, auto-cooldown and self-healing  (see proxy-pool.ts)
 *  • Platform cookies via env vars or remote cookies.txt URLs
 *    (YOUTUBE_COOKIES / *_COOKIES_URL …)  (see cookies.ts)
 *  • YouTube player-client rotation (web_safari / tv_embedded / web_embedded…)
 *  • Cobalt API fallback provider (COBALT_API_URL) for every platform
 *  • Forced IPv4 + retry hardening on every yt-dlp spawn
 *  • STREAMING downloads for progressive formats: the server extracts the CDN
 *    URL and pipes it straight to the browser with Range/resume support —
 *    zero temp disk, instant start, scales to hundreds of concurrent users
 *  • Legacy temp-file flow kept for MP3 conversion / DASH merging / fallback
 *  • Configurable concurrency (MAX_PARALLEL_EXTRACTIONS / MAX_PARALLEL_DOWNLOADS)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path   from "path";
import fs     from "fs";
import os     from "os";
import crypto from "crypto";
import https  from "https";
import http   from "http";
import { statsStore }   from "../stats-store.js";
import { igCookies, igProxies } from "../instagram-manager.js";
import { proxyPool, proxiedGet, agentFor } from "../proxy-pool.js";
import { platformKeyFor, cookieArgsFor, cookiesStatus } from "../cookies.js";
import { createStreamToken, verifyStreamToken } from "../stream-tokens.js";
import { YT_DLP_PATH, runYtDlp, parseYtDlpInfo, baseYtDlpArgs, proxyFor, proxyArgs } from "../ytdlp.js";

const router: IRouter = Router();

// ── Optional fallback services ────────────────────────────────────────────────
const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY  ?? "";
const COBALT_API_URL = (process.env.COBALT_API_URL ?? "").replace(/\/+$/, "");

// ── Temp directories ──────────────────────────────────────────────────────────
const downloadDir = path.join(os.tmpdir(), "fvd-dl");
const cookieDir   = path.join(os.tmpdir(), "fvd-cookies");
for (const d of [downloadDir, cookieDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── ffmpeg/ffprobe availability (checked once) ────────────────────────────────
let _ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  try {
    const r = require("child_process").spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
    _ffmpegAvailable = r.status === 0;
  } catch { _ffmpegAvailable = false; }
  return _ffmpegAvailable;
}

// ── UA pools ──────────────────────────────────────────────────────────────────
const DESKTOP_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.112 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.201 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
];
const MOBILE_UAS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
];
const ACCEPT_LANGS = [
  "en-US,en;q=0.9", "en-GB,en;q=0.9", "en-US,en;q=0.8,es;q=0.5", "en-CA,en;q=0.9,fr-CA;q=0.7",
];
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rDesktop = () => pick(DESKTOP_UAS);
const rMobile  = () => pick(MOBILE_UAS);
const rLang    = () => pick(ACCEPT_LANGS);

// ── Sleep / jitter ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Info cache ────────────────────────────────────────────────────────────────
const infoCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL_DEFAULT = 5 * 60_000;
const CACHE_TTL_TIKTOK  = 10 * 60_000;

function getCached(url: string): any | null {
  const e = infoCache.get(url);
  if (!e) return null;
  if (Date.now() > e.expiry) { infoCache.delete(url); return null; }
  return e.data;
}
function setCached(url: string, data: any, ttl = CACHE_TTL_DEFAULT) {
  if (infoCache.size >= 500) {
    infoCache.delete(infoCache.keys().next().value!);
  }
  infoCache.set(url, { data, expiry: Date.now() + ttl });
}

// ── In-flight dedup ───────────────────────────────────────────────────────────
const inFlight = new Map<string, Promise<any>>();

// ── Extracted-CDN-URL cache (stream mode) ─────────────────────────────────────
interface MediaResolution {
  cdnUrl: string;
  proxyUsed: string | null;
  filename: string;
  ext: string;
  filesize: number | null;
  platformKey: string;
}
const mediaCache = new Map<string, { res: MediaResolution; expiry: number }>();
const MEDIA_TTL_MS = 20 * 60_000; // CDN URLs typically live ≥ 1 h
function cacheMedia(url: string, formatId: string, res: MediaResolution) {
  if (mediaCache.size >= 1000) mediaCache.delete(mediaCache.keys().next().value!);
  mediaCache.set(`${url}|${formatId}`, { res, expiry: Date.now() + MEDIA_TTL_MS });
}
function getCachedMedia(url: string, formatId: string): MediaResolution | null {
  const e = mediaCache.get(`${url}|${formatId}`);
  if (!e) return null;
  if (Date.now() > e.expiry) { mediaCache.delete(`${url}|${formatId}`); return null; }
  return e.res;
}

// ── Concurrency control ───────────────────────────────────────────────────────
class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];
  constructor(max: number) { this.slots = max; }
  acquire() {
    return new Promise<void>(r => this.slots > 0 ? (this.slots--, r()) : this.queue.push(r));
  }
  release() {
    const next = this.queue.shift();
    if (next) next(); else this.slots++;
  }
  get waiting() { return this.queue.length; }
}
const MAX_EXTRACTIONS = Math.max(1, Number(process.env.MAX_PARALLEL_EXTRACTIONS ?? 6));
const MAX_FILE_DOWNLOADS = Math.max(1, Number(process.env.MAX_PARALLEL_DOWNLOADS ?? 4));
const extractSem  = new Semaphore(MAX_EXTRACTIONS);      // yt-dlp spawns (info + URL resolution)
const fileDlSem   = new Semaphore(MAX_FILE_DOWNLOADS);   // legacy temp-file downloads

async function withExtractSlot<T>(fn: () => Promise<T>): Promise<T> {
  await extractSem.acquire();
  try { return await fn(); } finally { extractSem.release(); }
}

// ── Network-aware yt-dlp wrapper ──────────────────────────────────────────────
function isProxyError(msg: string): boolean {
  const m = msg.toLowerCase();
  return /(timed out|etimedout|econnrefused|econnreset|enotfound|eai_again|econnaborted|socket hang up|407|proxy|tunneling|5\d\d )/.test(m);
}

async function ytDlpWithNet(
  platform: string,
  args: string[],
  timeoutMs: number,
  proxyUrl: string | null,
  cookieArgs: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  const full = [...baseYtDlpArgs(platform), ...proxyArgs(proxyUrl), ...cookieArgs, ...args];
  try {
    const r = await runYtDlp(full, timeoutMs);
    if (proxyUrl) proxyPool.reportSuccess(proxyUrl);
    return r;
  } catch (e: any) {
    const msg = e?.message ?? "";
    if (proxyUrl && isProxyError(msg)) proxyPool.reportFailure(proxyUrl, msg);
    throw e;
  }
}

// ── Quality formats ───────────────────────────────────────────────────────────
const QUALITY_TIERS = [
  { label: "4K (2160p)", height: 2160 },
  { label: "1080p",      height: 1080 },
  { label: "720p",       height: 720  },
  { label: "480p",       height: 480  },
  { label: "360p",       height: 360  },
];
const IG_TIERS = [
  { label: "1080p", height: 1080 },
  { label: "720p",  height: 720  },
  { label: "480p",  height: 480  },
  { label: "360p",  height: 360  },
];

function buildFormats(maxH: number, tiers = QUALITY_TIERS) {
  const fmts = tiers
    .filter(t => maxH >= t.height)
    .map(t => ({ formatId: `__q_${t.height}__`, ext: "mp4", quality: t.label, resolution: `${t.height}p`, filesize: null, hasVideo: true, hasAudio: true }));
  fmts.push({ formatId: "__mp3__", ext: "mp3", quality: "MP3 Audio", resolution: "audio", filesize: null, hasVideo: false, hasAudio: true });
  return fmts;
}

// ── URL utilities ─────────────────────────────────────────────────────────────
function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s"'<>)）]+/i);
  return m ? m[0].replace(/[.,;!?）\]]+$/, "").trim() : text.trim();
}

function isTikTok(url: string): boolean {
  const l = url.toLowerCase();
  return l.includes("tiktok.com") || l.includes("vm.tiktok") || l.includes("vt.tiktok");
}

function detectPlatform(url: string): string {
  const l = url.toLowerCase();
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "YouTube";
  if (isTikTok(url))  return "TikTok";
  if (l.includes("instagram.com")) return "Instagram";
  if (l.includes("facebook.com") || l.includes("fb.watch")) return "Facebook";
  if (l.includes("twitter.com") || l.includes("x.com"))    return "Twitter/X";
  if (l.includes("reddit.com") || l.includes("redd.it"))   return "Reddit";
  if (l.includes("vimeo.com"))    return "Vimeo";
  if (l.includes("pinterest.com")) return "Pinterest";
  return "Other";
}

function cleanUrl(url: string): string {
  const l = url.toLowerCase();
  try {
    const u = new URL(url);
    if (l.includes("instagram.com")) {
      ["igsh","igshid","utm_source","utm_medium","utm_campaign","fbclid","s"].forEach(p => u.searchParams.delete(p));
      return u.searchParams.size === 0 ? `${u.origin}${u.pathname.replace(/\/?$/, "/")}` : `${u.origin}${u.pathname}?${u.searchParams}`;
    }
    if (isTikTok(url)) return `${u.origin}${u.pathname}`;
  } catch {}
  return url;
}

// ── Short URL resolver ────────────────────────────────────────────────────────
function resolveShortUrl(url: string): Promise<string> {
  if (!url.toLowerCase().includes("vm.tiktok") && !url.toLowerCase().includes("vt.tiktok")) return Promise.resolve(url);
  return new Promise(resolve => {
    const follow = (cur: string, hops: number) => {
      if (hops > 5) { resolve(cur); return; }
      let parsed: URL;
      try { parsed = new URL(cur); } catch { resolve(url); return; }
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "HEAD", headers: { "User-Agent": rMobile() } }, res => {
        const loc = res.headers["location"];
        if (loc && res.statusCode! >= 300 && res.statusCode! < 400) {
          follow(loc.startsWith("http") ? loc : `${parsed.origin}${loc}`, hops + 1);
        } else resolve(cur);
      });
      req.setTimeout(8_000, () => { req.destroy(); resolve(cur); });
      req.on("error", () => resolve(cur));
      req.end();
    };
    follow(url, 0);
  });
}

// ── Filename helper ───────────────────────────────────────────────────────────
function safeFilename(title: string | null | undefined, height: number | null, ext: string, fallback = "video"): string {
  let base = (title ?? "").replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!base) base = fallback;
  if (height) base += `_${height}p`;
  return `${base}.${ext}`;
}

// ── Error classifier ──────────────────────────────────────────────────────────
function classifyError(raw: string, platform?: string): { status: number; code: string; userMessage: string } {
  const m = raw.toLowerCase();
  if (platform === "TikTok") {
    if (m.includes("private"))                     return { status: 403, code: "TT_PRIVATE",  userMessage: "This TikTok is private or friends-only." };
    if (m.includes("rate") || m.includes("429"))   return { status: 429, code: "TT_RATE",     userMessage: "TikTok is temporarily rate-limited. Please wait a minute and try again." };
    if (m.includes("not found") || m.includes("deleted")) return { status: 404, code: "TT_NOT_FOUND", userMessage: "TikTok video not found — it may have been deleted." };
  }
  if (platform === "Instagram") {
    if (m.includes("login") || m.includes("403"))  return { status: 403, code: "IG_AUTH",     userMessage: "Instagram requires login. Set INSTAGRAM_SESSION_ID or add your cookie via the UI." };
    if (m.includes("rate") || m.includes("429"))   return { status: 429, code: "IG_RATE",     userMessage: "Instagram is temporarily limiting requests. Wait 30 seconds and try again." };
  }
  if (m.includes("sign in to confirm") || m.includes("not a bot") || m.includes("bot check") || m.includes("captcha") || m.includes("bot-challenging") || m.includes("bot challenge")) {
    return { status: 403, code: "BOT_CHECK",
      userMessage: process.env.YOUTUBE_COOKIES || process.env.YOUTUBE_COOKIES_URL || process.env.PROXIES
        ? "The platform challenged this request. Cookies/proxies may need refreshing on the server."
        : "The platform is blocking this server's IP. The operator should configure PROXIES and YOUTUBE_COOKIES on the server." };
  }
  if (m.includes("private"))                       return { status: 403, code: "PRIVATE",     userMessage: "This video is private or requires login." };
  if (m.includes("not found") || m.includes("404")) return { status: 404, code: "NOT_FOUND",  userMessage: "Video not found — it may have been deleted or the link is broken." };
  if (m.includes("429") || m.includes("rate limit")) return { status: 429, code: "RATE_LIMIT", userMessage: "Too many requests. Please wait 30 seconds and try again." };
  if (m.includes("timed out"))                     return { status: 504, code: "TIMEOUT",     userMessage: "Request timed out. Please try again." };
  if (m.includes("no video") || m.includes("unsupported url")) return { status: 422, code: "UNSUPPORTED", userMessage: "No downloadable video found at this URL." };
  return { status: 500, code: "UNKNOWN", userMessage: "Could not process this video. Please check the URL and try again." };
}

// ── File output finder ────────────────────────────────────────────────────────
function findOutput(fileId: string): string | null {
  const files = fs.readdirSync(downloadDir).filter(f => f.startsWith(fileId));
  return files.length > 0 ? files[0] : null;
}

// ── Download validation (graceful if ffprobe missing) ─────────────────────────
async function validateDownload(filePath: string, fileId: string, isAudio = false): Promise<string> {
  const MIN_SIZE = 8_192;
  const stat = fs.statSync(filePath);
  if (stat.size < MIN_SIZE) throw new Error(`File too small (${stat.size}B) — likely an error response.`);

  // Magic bytes check
  const buf = Buffer.alloc(8);
  const fd  = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const head = buf.toString("utf8", 0, 8).toLowerCase();
  if (head.startsWith("<!") || head.startsWith("<ht") || head.startsWith("{")) {
    throw new Error("Downloaded file is an error page, not a video.");
  }

  if (isAudio || !hasFfmpeg()) return path.basename(filePath);

  // Codec probe + re-encode if needed
  const codecInfo = await new Promise<{ video: string | null; audio: string | null }>((resolve) => {
    const p = require("child_process").spawn("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", filePath]);
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d; });
    p.on("close", () => {
      try {
        const streams = JSON.parse(out).streams ?? [];
        resolve({ video: streams.find((s: any) => s.codec_type === "video")?.codec_name ?? null, audio: streams.find((s: any) => s.codec_type === "audio")?.codec_name ?? null });
      } catch { resolve({ video: null, audio: null }); }
    });
    p.on("error", () => resolve({ video: null, audio: null }));
  });

  if (!codecInfo.video) throw new Error("Downloaded file has no video stream.");

  const needReencode = codecInfo.video !== "h264" || (codecInfo.audio && codecInfo.audio !== "aac");
  if (!needReencode) return path.basename(filePath);

  const out = path.join(downloadDir, `${fileId}_h264.mp4`);
  await new Promise<void>((resolve, reject) => {
    const p = require("child_process").spawn("ffmpeg", ["-i", filePath, "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", out]);
    let err = "";
    p.stderr.on("data", (d: Buffer) => { err += d; });
    p.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.slice(-200)}`)));
    p.on("error", reject);
  });
  try { fs.unlinkSync(filePath); } catch {}
  return `${fileId}_h264.mp4`;
}

// ── Cobalt fallback provider (works for every platform) ───────────────────────
async function cobaltResolve(url: string, opts: { audioOnly?: boolean; qualityHeight?: number } = {}): Promise<string | null> {
  if (!COBALT_API_URL) return null;
  const body = JSON.stringify({
    url,
    videoQuality: String(Math.min(opts.qualityHeight ?? 1080, 1080)),
    audioFormat: opts.audioOnly ? "mp3" : "mp4",
    filenameStyle: "basic",
  });
  return new Promise(resolve => {
    let parsed: URL;
    try { parsed = new URL(COBALT_API_URL); } catch { resolve(null); return; }
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.on("data", (d: Buffer) => { data += d; });
      res.on("end", () => {
        try {
          const p = JSON.parse(data);
          if ((p?.status === "tunnel" || p?.status === "redirect" || p?.status === "stream") && p.url) {
            console.log(`[Cobalt] resolved ${p.status} for ${url.slice(0, 60)}`);
            resolve(p.url as string);
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.setTimeout(20_000, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ── Resolve a direct CDN media URL (stream mode) ──────────────────────────────
async function resolveMediaUrl(
  url: string,
  formatId: string,
  platform: string,
  opts: { strictHeight?: boolean } = {},
): Promise<MediaResolution | null> {
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;
  const isAudio = formatId === "__mp3__";
  const pKey    = platformKeyFor(url);
  const proxyUsed = proxyFor(platform);
  const cookies  = await cookieArgsFor(pKey);

  // 1. yt-dlp — prefer progressive formats (video+audio in one stream)
  try {
    const { stdout } = await withExtractSlot(() =>
      ytDlpWithNet(platform, ["--dump-json", "--no-playlist", "--no-warnings", "--no-check-certificates", url], 45_000, proxyUsed, cookies),
    );
    const info = parseYtDlpInfo(stdout);
    if (info) {
      // Progressive = video+audio in one URL. null vcodec/acodec means "unknown"
      // (direct files) — treat as usable; only explicit "none" marks DASH-only.
      // HLS/DASH manifests (m3u8/mpd) can't be served as a file download.
      const progressive = ((info.formats ?? []) as any[])
        .filter((f) => f.url && f.vcodec !== "none" && f.acodec !== "none")
        .filter((f) => {
          const proto = String(f.protocol ?? "https");
          const ext = String(f.ext ?? "");
          return !proto.includes("m3u8") && !proto.includes("mpd") && proto !== "mhtml" && ext !== "m3u8" && ext !== "mpd";
        })
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0));
      let chosen = height ? progressive.find(f => (f.height ?? 0) <= height) : progressive[0];
      if (chosen) {
        // prefer mp4 rendition at the same height
        const sameH = progressive.filter(f => (f.height ?? 0) === (chosen.height ?? 0));
        const mp4 = sameH.find(f => (f.ext ?? "") === "mp4" || String(f.vcodec ?? "").startsWith("avc"));
        if (mp4) chosen = mp4;
        // strict mode (YouTube): don't silently downgrade past the requested tier
        if (opts.strictHeight && height && (chosen.height ?? 0) < height - 20) chosen = null;
      }
      if (chosen?.url) {
        console.log(`[resolve] ✓ ${platform} progressive ${chosen.height ?? "?"}p ${chosen.ext} (proxy=${proxyUsed ? "yes" : "no"})`);
        return {
          cdnUrl: chosen.url,
          proxyUsed,
          filename: safeFilename(info.title, chosen.height ?? height, chosen.ext || "mp4"),
          ext: chosen.ext || "mp4",
          filesize: chosen.filesize ?? chosen.filesize_approx ?? null,
          platformKey: pKey,
        };
      }
      console.warn(`[resolve] ${platform}: no usable progressive format — will fall back to file mode`);
    }
  } catch (err: any) {
    console.warn(`[resolve] ${platform} yt-dlp failed: ${err.message?.slice(0, 120)}`);
  }

  // 2. Cobalt fallback (server-side URL resolution via external service)
  const cobaltUrl = await cobaltResolve(url, { audioOnly: isAudio, qualityHeight: height ?? undefined });
  if (cobaltUrl) {
    return {
      cdnUrl: cobaltUrl,
      proxyUsed: null,
      filename: safeFilename(null, height, isAudio ? "mp3" : "mp4", `${platform.toLowerCase()}_video`),
      ext: isAudio ? "mp3" : "mp4",
      filesize: null,
      platformKey: pKey,
    };
  }

  return null;
}

// ── Streaming endpoint helpers ────────────────────────────────────────────────
const STREAM_REFERER: Record<string, string> = {
  youtube:   "https://www.youtube.com/",
  tiktok:    "https://www.tiktok.com/",
  instagram: "https://www.instagram.com/",
  facebook:  "https://www.facebook.com/",
  twitter:   "https://x.com/",
  reddit:    "https://www.reddit.com/",
  vimeo:     "https://vimeo.com/",
  pinterest: "https://www.pinterest.com/",
};

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function openUpstream(cdnUrl: string, opts: { range?: string; proxyUrl: string | null; referer?: string }): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(cdnUrl); } catch (e) { reject(e); return; }
    const lib = parsed.protocol === "https:" ? https : http;
    const agent = opts.proxyUrl ? agentFor(opts.proxyUrl) : undefined;
    const headers: Record<string, string> = {
      "User-Agent": rDesktop(),
      "Accept": "*/*",
      "Accept-Language": rLang(),
    };
    if (opts.referer) headers["Referer"] = opts.referer;
    if (opts.range) headers["Range"] = opts.range;
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === "https:" ? 443 : 80), path: parsed.pathname + parsed.search, method: "GET", headers, ...(agent ? { agent } : {}) },
      res => resolve(res),
    );
    req.setTimeout(30_000, () => req.destroy(new Error("upstream connect timeout")));
    req.on("error", reject);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Platform providers — INFO
// ══════════════════════════════════════════════════════════════════════════════

// ── TikTok — Provider F: webpage scrape (routed through proxy pool) ───────────
async function fetchTikTokHtml(url: string): Promise<string> {
  const proxyUrl = proxyFor("TikTok");
  const result = await proxiedGet(url, {
    headers: {
      "User-Agent": rDesktop(),
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": rLang(),
      "Referer": "https://www.tiktok.com/",
      "Cookie": "tt_chain_token=; ttwid=; tiktok_webapp_theme=light",
    },
    timeoutMs: 20_000,
    proxyUrl,
    maxRedirects: 5,
  });
  if (result.status >= 400) throw new Error(`HTTP ${result.status}`);
  if (proxyUrl) proxyPool.reportSuccess(proxyUrl);
  return result.body;
}

function parseTikTokHtml(html: string): { title: string; thumbnail: string | null; duration: number | null; uploader: string | null; height: number } | null {
  if (/verify|captcha|robot|blocked/i.test(html.slice(0, 500))) return null;

  // Method 1: __UNIVERSAL_DATA_FOR_REHYDRATION__
  const um = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (um) {
    try {
      const scope = JSON.parse(um[1])?.["__DEFAULT_SCOPE__"];
      const item = scope?.["webapp.video-detail"]?.itemInfo?.itemStruct ?? scope?.["webapp.video-detail"]?.itemList?.[0];
      if (item?.video) {
        const v = item.video;
        return { title: item.desc?.trim() || "TikTok Video", thumbnail: v.cover ?? null, duration: v.duration ?? null, uploader: item.author?.nickname ?? null, height: v.height > 0 ? v.height : 720 };
      }
    } catch {}
  }

  // Method 2: SIGI_STATE
  const sm = html.match(/\bSIGI_STATE\b\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (sm) {
    try {
      const items = JSON.parse(sm[1])?.ItemModule;
      if (items) {
        const first = Object.values(items)[0] as any;
        if (first?.video) return { title: first.desc?.trim() || "TikTok Video", thumbnail: first.video.cover ?? null, duration: first.video.duration ?? null, uploader: first.author ?? null, height: first.video.height > 0 ? first.video.height : 720 };
      }
    } catch {}
  }
  return null;
}

// ── TikTok — Provider G: RapidAPI ────────────────────────────────────────────
function fetchTikTokRapidAPI(url: string): Promise<any | null> {
  if (!RAPIDAPI_KEY) return Promise.resolve(null);
  return new Promise(resolve => {
    const req = https.request({
      method: "GET",
      hostname: "tiktok-scraper7.p.rapidapi.com",
      path: `/video/info/?url=${encodeURIComponent(url)}`,
      headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com" },
    }, res => {
      let body = "";
      res.on("data", (d: Buffer) => { body += d; });
      res.on("end", () => {
        try {
          const p = JSON.parse(body);
          if (!p?.data?.id) { resolve(null); return; }
          const d = p.data;
          resolve({ title: d.title || d.desc || "TikTok Video", thumbnail: d.cover ?? null, duration: d.duration ?? null, uploader: d.author?.nickname ?? null, platform: "TikTok", formats: buildFormats(d.height || 1080), _rapidapi_play_url: d.play ?? null });
        } catch { resolve(null); }
      });
    });
    req.setTimeout(15_000, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.end();
  });
}

// ── TikTok yt-dlp provider arg builders ───────────────────────────────────────
const TT_BASE = ["--no-check-certificates", "--socket-timeout", "15"];

const ttProviders = [
  (ua = rMobile()) => ["--user-agent", ua, "--add-header", `Referer:https://www.tiktok.com/`, "--add-header", `Accept-Language:${rLang()}`, "--extractor-args", "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com", ...TT_BASE],
  (ua = rDesktop()) => ["--user-agent", ua, "--add-header", `Referer:https://www.tiktok.com/`, "--add-header", `Accept-Language:${rLang()}`, ...TT_BASE],
  (ua = rMobile()) => ["--user-agent", ua, "--add-header", `Referer:https://www.tiktok.com/`, "--add-header", `Accept-Language:${rLang()}`, "--extractor-args", "tiktok:app_name=trill", ...TT_BASE],
  (ua = rMobile()) => ["--user-agent", ua, "--add-header", `Referer:https://www.tiktok.com/`, "--add-header", `Accept-Language:${rLang()}`, "--extractor-args", "tiktok:app_name=musical_ly", ...TT_BASE],
];

// ── TikTok info — FAST PATH: F+G in parallel first, yt-dlp only as fallback ──
async function getTikTokInfo(url: string): Promise<any> {
  function buildResult(info: any, height: number = 1080) {
    const maxH = info.formats ? Math.max(...(info.formats as any[]).map((f: any) => f.height ?? 0).filter((h: number) => h > 0), height) : height;
    return { title: info.title ?? "TikTok Video", thumbnail: info.thumbnail ?? null, duration: info.duration ?? null, uploader: info.uploader ?? info.channel ?? null, platform: "TikTok", formats: buildFormats(maxH) };
  }

  // ── Stage 1: F (webpage) + G (RapidAPI) in PARALLEL — typically 1–3 s ────
  console.log(`[TikTok] Stage 1: webpage + RapidAPI in parallel`);
  const [webResult, apiResult] = await Promise.allSettled([
    fetchTikTokHtml(url).then(html => parseTikTokHtml(html)),
    fetchTikTokRapidAPI(url),
  ]);

  if (webResult.status === "fulfilled" && webResult.value) {
    const d = webResult.value;
    console.log(`[TikTok] ✓ Provider F succeeded`);
    return { title: d.title, thumbnail: d.thumbnail, duration: d.duration, uploader: d.uploader, platform: "TikTok", formats: buildFormats(d.height) };
  }
  if (apiResult.status === "fulfilled" && apiResult.value) {
    console.log(`[TikTok] ✓ Provider G (RapidAPI) succeeded`);
    return apiResult.value;
  }

  // ── Stage 2: yt-dlp providers A–D (12 s timeout each, fast-fail) ─────────
  console.log(`[TikTok] Stage 2: yt-dlp providers`);
  const BASE = ["--dump-json", "--no-playlist", "--no-warnings"];
  for (let i = 0; i < ttProviders.length; i++) {
    const label = `Provider ${String.fromCharCode(65 + i)}`;
    try {
      console.log(`[TikTok] trying ${label}`);
      const proxyUrl = proxyFor("TikTok");
      const cookies  = await cookieArgsFor("tiktok");
      const { stdout } = await withExtractSlot(() => ytDlpWithNet("TikTok", [...BASE, ...ttProviders[i](), url], 12_000, proxyUrl, cookies));
      const info = parseYtDlpInfo(stdout);
      if (info) { console.log(`[TikTok] ✓ ${label} succeeded`); return buildResult(info); }
    } catch (err: any) {
      console.warn(`[TikTok] ${label} failed: ${err.message?.slice(0, 100)}`);
      if (i < ttProviders.length - 1) await sleep(500);
    }
  }

  throw new Error("TikTok: failed to fetch video info after every strategy. The video may be unavailable or TikTok is blocking this server address.");
}

// ── Instagram info ────────────────────────────────────────────────────────────
const IG_APP_ID = "936619743392459";
const igDesktopArgs = (ua = rDesktop()) => [
  "--user-agent", ua,
  "--add-header", "Accept-Language:en-US,en;q=0.9",
  "--add-header", `Referer:https://www.instagram.com/`,
  "--add-header", `X-IG-App-ID:${IG_APP_ID}`,
  "--extractor-args", "instagram:player_client=android,ios,web",
  "--no-check-certificates", "--socket-timeout", "30",
];
const igMobileArgs = (ua = rMobile()) => [
  "--user-agent", ua,
  "--add-header", "Accept-Language:en-US,en;q=0.9",
  "--add-header", `Referer:https://www.instagram.com/`,
  "--add-header", `X-IG-App-ID:${IG_APP_ID}`,
  "--extractor-args", "instagram:player_client=android,ios,web",
  "--no-check-certificates", "--socket-timeout", "30",
];

function igProxy(): string[] {
  const igSpecific = igProxies.getNext();
  const p = igSpecific ?? proxyPool.getNext();
  return p ? ["--proxy", p] : [];
}

async function getInstagramInfo(url: string): Promise<any> {
  const BASE = ["--dump-json", "--no-playlist", "--no-warnings"];
  const cookie = igCookies.getNext();
  const cookieFile = cookie ? igCookies.toCookieFile(cookie) : null;

  function buildResult(info: any) {
    const maxH = Math.max(...((info.formats ?? []) as any[]).map((f: any) => f.height ?? 0).filter((h: number) => h > 0), 720);
    return { title: info.title ?? info.description?.slice(0, 80) ?? "Instagram Video", thumbnail: info.thumbnail ?? null, duration: info.duration ?? null, uploader: info.uploader ?? null, platform: "Instagram", formats: buildFormats(maxH, IG_TIERS) };
  }

  const strategies = [
    ...(cookieFile ? [{ label: "cookie + desktop", args: () => [...BASE, ...igDesktopArgs(), "--cookies", cookieFile!, ...igProxy(), url] }] : []),
    { label: "anonymous", args: () => [...BASE, ...igDesktopArgs(), ...igProxy(), url] },
    ...(cookieFile ? [{ label: "cookie + mobile", args: () => [...BASE, ...igMobileArgs(), "--cookies", cookieFile!, ...igProxy(), url] }] : []),
  ];

  for (const s of strategies) {
    try {
      console.log(`[IG] info: ${s.label}`);
      const { stdout } = await withExtractSlot(() => runYtDlp(s.args(), 60_000));
      const info = parseYtDlpInfo(stdout);
      if (info) { console.log(`[IG] ✓ info (${s.label})`); if (cookie) igCookies.markSuccess(cookie.id); return buildResult(info); }
    } catch (err: any) {
      const m = (err?.message ?? "").toLowerCase();
      if (cookie && (m.includes("403") || m.includes("login"))) igCookies.markFailed(cookie.id);
      console.warn(`[IG] info ${s.label} failed: ${err?.message?.slice(0, 100)}`);
    }
  }
  throw new Error(!cookieFile ? "Instagram requires authentication. Set INSTAGRAM_SESSION_ID." : "Instagram: all strategies failed. Cookie may be expired.");
}

// ── YouTube info — player-client rotation + cookies + proxy ───────────────────
const YT_CLIENTS = ["web_safari", "tv_embedded", "web_embedded", "mweb", "web"];

async function getYouTubeInfo(url: string): Promise<any> {
  const BASE = ["--dump-json", "--no-playlist", "--no-warnings"];
  const cookies = await cookieArgsFor("youtube");
  const proxyUrl = proxyFor("YouTube");

  const attempts: Array<{ label: string; args: string[] }> = [];
  // Pass 1: no cookies, no proxy (works when the DC IP isn't flagged)
  for (const c of YT_CLIENTS.slice(0, 2)) {
    attempts.push({ label: `client=${c}`, args: [...BASE, "--extractor-args", `youtube:player_client=${c}`, url] });
  }
  // Pass 2: with cookies (breaks bot walls when the operator added them)
  if (cookies.length > 0) {
    for (const c of YT_CLIENTS.slice(0, 2)) {
      attempts.push({ label: `client=${c}+cookies`, args: [...BASE, "--extractor-args", `youtube:player_client=${c}`, url] });
    }
  }
  // Pass 3: proxy + cookies + remaining clients
  for (const c of YT_CLIENTS.slice(2)) {
    attempts.push({ label: `client=${c}${proxyUrl ? "+proxy" : ""}`, args: [...BASE, "--extractor-args", `youtube:player_client=${c}`, url] });
  }

  // Run in parallel chunks of 2 — first success wins
  const CHUNK = 2;
  for (let i = 0; i < attempts.length; i += CHUNK) {
    const chunk = attempts.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map(a => withExtractSlot(() => ytDlpWithNet("YouTube", a.args, 20_000, proxyUrl, cookies)).then(r => ({ label: a.label, info: parseYtDlpInfo(r.stdout) }))),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.info) {
        console.log(`[YouTube] ✓ info via ${r.value.label}`);
        const info = r.value.info;
        const maxH = Math.max(...((info.formats ?? []) as any[]).map((f: any) => f.height ?? 0).filter((h: number) => h > 0), 360);
        return { title: info.title ?? "YouTube Video", thumbnail: info.thumbnail ?? null, duration: info.duration ?? null, uploader: info.uploader ?? info.channel ?? null, platform: "YouTube", formats: buildFormats(maxH) };
      }
    }
  }

  throw new Error(cookies.length || proxyUrl
    ? "YouTube: all strategies failed even with cookies/proxy. Cookies may be expired."
    : "YouTube is bot-challenging this server. Operator: set YOUTUBE_COOKIES (or YOUTUBE_COOKIES_URL) and/or PROXIES.");
}

// ── Generic info / download (Facebook, Twitter/X, Reddit, Vimeo, …) ───────────
async function getGenericInfo(url: string): Promise<any> {
  const platform = detectPlatform(url);
  const cookies  = await cookieArgsFor(platformKeyFor(url));
  const proxyUrl = proxyFor(platform);
  try {
    const { stdout } = await withExtractSlot(() => ytDlpWithNet(platform, ["--dump-json", "--no-playlist", "--no-warnings", "--user-agent", rDesktop(), "--add-header", `Accept-Language:${rLang()}`, url], 45_000, proxyUrl, cookies));
    const info = parseYtDlpInfo(stdout);
    if (!info) throw new Error("No video data received");
    const maxH = Math.max(...((info.formats ?? []) as any[]).map((f: any) => f.height ?? 0).filter((h: number) => h > 0), 720);
    return { title: info.title ?? "Unknown", thumbnail: info.thumbnail ?? null, duration: info.duration ?? null, uploader: info.uploader ?? null, platform, formats: buildFormats(maxH) };
  } catch (err: any) {
    // Last resort: cobalt can download but not give metadata — serve a minimal card
    if (COBALT_API_URL) {
      const test = await cobaltResolve(url, {});
      if (test) {
        console.log(`[Generic] yt-dlp failed but cobalt can handle ${platform}`);
        return { title: "Video", thumbnail: null, duration: null, uploader: null, platform, formats: buildFormats(720) };
      }
    }
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Platform providers — DOWNLOAD (legacy temp-file mode: MP3 / DASH merge)
// ══════════════════════════════════════════════════════════════════════════════

const AUDIO_ARGS = ["--format", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"];

async function downloadTikTokFile(url: string, formatId: string, fileId: string): Promise<string> {
  const outTpl  = path.join(downloadDir, `${fileId}.%(ext)s`);
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;
  const isAudio = formatId === "__mp3__";

  const fmtArgs = isAudio
    ? AUDIO_ARGS
    : height
      ? ["--format", `bestvideo[height<=${height}][format_note!*=watermark][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}][ext=mp4]+bestaudio/best[height<=${height}]/best`, "--merge-output-format", "mp4"]
      : ["--format", "bestvideo[format_note!*=watermark][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best", "--merge-output-format", "mp4"];

  const BASE_DL = ["--no-playlist", "--no-warnings", "--output", outTpl];
  const cookies = await cookieArgsFor("tiktok");

  for (let i = 0; i < ttProviders.length; i++) {
    const label = `Provider ${String.fromCharCode(65 + i)}`;
    try {
      console.log(`[TikTok] file-download ${label}`);
      const proxyUrl = proxyFor("TikTok");
      await withExtractSlot(() => ytDlpWithNet("TikTok", [...fmtArgs, ...BASE_DL, ...ttProviders[i](), url], 120_000, proxyUrl, cookies));
      const f = findOutput(fileId);
      if (f) {
        console.log(`[TikTok] ✓ downloaded via ${label}`);
        return await validateDownload(path.join(downloadDir, f), fileId, isAudio);
      }
    } catch (err: any) {
      console.warn(`[TikTok] dl ${label} failed: ${err.message?.slice(0, 100)}`);
      if (i < ttProviders.length - 1) await sleep(500);
    }
  }
  throw new Error("TikTok: download failed after all strategies.");
}

async function downloadInstagramFile(url: string, formatId: string, fileId: string): Promise<string> {
  const outTpl  = path.join(downloadDir, `${fileId}.%(ext)s`);
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;
  const isAudio = formatId === "__mp3__";
  const BASE_DL = ["--no-playlist", "--no-warnings", "--output", outTpl];

  const fmtArgs = isAudio
    ? AUDIO_ARGS
    : height
      ? ["--format", `bestvideo[height<=${height}][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`, "--merge-output-format", "mp4"]
      : ["--format", "best[ext=mp4]/best", "--merge-output-format", "mp4"];

  const cookie = igCookies.getNext();
  const cookieFile = cookie ? igCookies.toCookieFile(cookie) : null;

  const strategies = [
    ...(cookieFile ? [{ label: "cookie + desktop", args: () => [...fmtArgs, ...BASE_DL, ...igDesktopArgs(), "--cookies", cookieFile!, ...igProxy(), url] }] : []),
    { label: "anonymous", args: () => [...fmtArgs, ...BASE_DL, ...igDesktopArgs(), ...igProxy(), url] },
    ...(cookieFile ? [{ label: "cookie + mobile", args: () => [...fmtArgs, ...BASE_DL, ...igMobileArgs(), "--cookies", cookieFile!, ...igProxy(), url] }] : []),
  ];

  for (const s of strategies) {
    try {
      console.log(`[IG] download: ${s.label}`);
      await withExtractSlot(() => runYtDlp(s.args(), 300_000));
      const f = findOutput(fileId);
      if (f) { console.log(`[IG] ✓ downloaded (${s.label})`); if (cookie) igCookies.markSuccess(cookie.id); return await validateDownload(path.join(downloadDir, f), fileId, isAudio); }
    } catch (err: any) {
      const m = (err?.message ?? "").toLowerCase();
      if (cookie && (m.includes("403") || m.includes("login"))) igCookies.markFailed(cookie.id);
      console.warn(`[IG] download ${s.label} failed: ${err?.message?.slice(0, 100)}`);
    }
  }
  throw new Error(!cookieFile ? "Instagram requires authentication. Set INSTAGRAM_SESSION_ID." : "Instagram: download failed. Cookie may be expired.");
}

async function downloadYouTubeFile(url: string, formatId: string, fileId: string): Promise<string> {
  const outTpl  = path.join(downloadDir, `${fileId}.%(ext)s`);
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;
  const isAudio = formatId === "__mp3__";

  const fmtArgs = isAudio
    ? AUDIO_ARGS
    : height
      ? ["--format", `bestvideo[height<=${height}][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`, "--merge-output-format", "mp4"]
      : ["--format", "bestvideo[ext=mp4]+bestaudio/best", "--merge-output-format", "mp4"];

  const BASE_DL = ["--no-playlist", "--no-warnings", "--output", outTpl];
  const cookies = await cookieArgsFor("youtube");
  const proxyUrl = proxyFor("YouTube");

  const clients = ["default", "web_safari", "tv_embedded"];
  for (const c of clients) {
    const label = `client=${c}`;
    try {
      console.log(`[YouTube] file-download ${label}`);
      const extra = c === "default" ? [] : ["--extractor-args", `youtube:player_client=${c}`];
      await withExtractSlot(() => ytDlpWithNet("YouTube", [...fmtArgs, ...BASE_DL, ...extra, url], 300_000, proxyUrl, cookies));
      const f = findOutput(fileId);
      if (f) return await validateDownload(path.join(downloadDir, f), fileId, isAudio);
    } catch (err: any) {
      console.warn(`[YouTube] dl ${label} failed: ${err.message?.slice(0, 100)}`);
    }
  }
  throw new Error("YouTube: download failed after all strategies.");
}

async function downloadGenericFile(url: string, formatId: string, fileId: string): Promise<string> {
  const outTpl  = path.join(downloadDir, `${fileId}.%(ext)s`);
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;
  const isAudio = formatId === "__mp3__";
  const platform = detectPlatform(url);
  const cookies  = await cookieArgsFor(platformKeyFor(url));
  const proxyUrl = proxyFor(platform);

  const fmtArgs = isAudio
    ? AUDIO_ARGS
    : height
      ? ["--format", `bestvideo[height<=${height}][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`, "--merge-output-format", "mp4"]
      : ["--format", "best[ext=mp4]/best", "--merge-output-format", "mp4"];

  const baseArgs = ["--user-agent", rDesktop(), "--add-header", `Accept-Language:${rLang()}`, "--no-playlist", "--no-warnings", "--output", outTpl, url];
  await withExtractSlot(() => ytDlpWithNet(platform, [...fmtArgs, ...baseArgs], 300_000, proxyUrl, cookies));
  const f = findOutput(fileId);
  if (!f) throw new Error("Download produced no output file");
  return await validateDownload(path.join(downloadDir, f), fileId, isAudio);
}

// ══════════════════════════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════════════════════════

// ── Instagram cookie management ───────────────────────────────────────────────
router.get("/instagram-status", (_req: Request, res: Response) => {
  res.json({ configured: igCookies.size > 0, cookiePool: igCookies.statusReport(), proxyPool: { enabled: igProxies.hasProxies, count: igProxies.count } });
});

router.post("/instagram-cookies", (req: Request, res: Response) => {
  const { sessionid } = req.body as { sessionid?: string };
  if (!sessionid?.trim()) { res.status(400).json({ error: "sessionid is required" }); return; }
  const cookiesFile = path.join(process.cwd(), "ig-cookies.json");
  const cleaned = sessionid.trim().replace(/^sessionid\s*=\s*/i, "");
  let data: any = { cookies: [] };
  if (fs.existsSync(cookiesFile)) { try { data = JSON.parse(fs.readFileSync(cookiesFile, "utf8")); } catch {} }
  data.cookies = (data.cookies ?? []).filter((c: any) => c.id !== "__user__");
  data.cookies.unshift({ id: "__user__", description: "User-provided session cookie", cookie_string: `sessionid=${cleaned}`, active: true });
  fs.writeFileSync(cookiesFile, JSON.stringify(data, null, 2), "utf8");
  igCookies.load();
  res.json({ success: true, message: "Cookie saved. Instagram downloads are now enabled." });
});

// ── GET /api/video/status — operator diagnostics ──────────────────────────────
router.get("/status", async (_req: Request, res: Response) => {
  let ytDlpVersion: string | null = null;
  try {
    const r = await runYtDlp(["--version"], 8_000);
    ytDlpVersion = r.stdout.trim() || null;
  } catch { ytDlpVersion = null; }
  res.json({
    ytDlp: { path: YT_DLP_PATH, version: ytDlpVersion },
    proxies: proxyPool.statusReport(),
    cookies: cookiesStatus(),
    cobalt: { configured: Boolean(COBALT_API_URL) },
    rapidapi: { configured: Boolean(RAPIDAPI_KEY) },
    concurrency: { extractions: MAX_EXTRACTIONS, fileDownloads: MAX_FILE_DOWNLOADS, extractionQueue: extractSem.waiting },
    uptime: Math.floor(process.uptime()),
  });
});

// ── POST /api/video/info ──────────────────────────────────────────────────────
router.post("/info", async (req: Request, res: Response) => {
  const raw = (req.body as { url?: string }).url;
  if (!raw || typeof raw !== "string") { res.status(400).json({ error: "URL is required", code: "MISSING_URL" }); return; }

  const extracted = extractUrl(raw);
  let resolved = extracted;
  if (isTikTok(extracted)) { try { resolved = await resolveShortUrl(extracted); } catch {} }
  const url = cleanUrl(resolved);

  try { new URL(url); } catch { res.status(400).json({ error: "Invalid video URL", code: "INVALID_URL" }); return; }

  // Cache hit
  const cached = getCached(url);
  if (cached) { res.json(cached); return; }

  // In-flight dedup
  const key = `info:${url}`;
  if (inFlight.has(key)) {
    try { res.json(await inFlight.get(key)); } catch (e: any) { const c = classifyError(e.message, detectPlatform(url)); res.status(c.status).json({ error: c.userMessage, code: c.code }); }
    return;
  }

  const platform = detectPlatform(url);
  const promise = platform === "Instagram" ? getInstagramInfo(url)
    : platform === "TikTok" ? getTikTokInfo(url)
    : platform === "YouTube" ? getYouTubeInfo(url)
    : getGenericInfo(url);
  inFlight.set(key, promise);

  try {
    const result = await promise;
    inFlight.delete(key);
    setCached(url, result, platform === "TikTok" ? CACHE_TTL_TIKTOK : CACHE_TTL_DEFAULT);
    res.json(result);
  } catch (e: any) {
    inFlight.delete(key);
    const c = classifyError(e.message, platform);
    res.status(c.status).json({ error: c.userMessage, code: c.code });
  }
});

// ── POST /api/video/download ──────────────────────────────────────────────────
router.post("/download", async (req: Request, res: Response) => {
  const { url: rawUrl, formatId } = req.body as { url?: string; formatId?: string };
  if (!rawUrl) { res.status(400).json({ error: "URL is required", code: "MISSING_URL" }); return; }
  if (!formatId) { res.status(400).json({ error: "Format is required", code: "MISSING_FORMAT" }); return; }

  const extracted = extractUrl(rawUrl);
  let resolved = extracted;
  if (isTikTok(extracted)) { try { resolved = await resolveShortUrl(extracted); } catch {} }
  const url = cleanUrl(resolved);
  const platform = detectPlatform(url);
  const fileId = crypto.randomBytes(16).toString("hex");
  const isAudio = formatId === "__mp3__";
  const qMatch  = formatId.match(/^__q_(\d+)__$/);
  const height  = qMatch ? parseInt(qMatch[1], 10) : null;

  // ── Decide transport mode ────────────────────────────────────────────────
  // stream: progressive CDN URL piped straight to the browser (no temp disk)
  // file:   legacy yt-dlp temp-file flow (MP3 conversion, DASH merge, fallback)
  const streamEligible =
    !isAudio &&
    !(platform === "YouTube" && (height ?? 0) > 720); // YT >720p needs DASH merge

  if (streamEligible) {
    try {
      let media = getCachedMedia(url, formatId);
      if (!media) {
        media = await resolveMediaUrl(url, formatId, platform, { strictHeight: platform === "YouTube" });
        if (media) cacheMedia(url, formatId, media);
      }
      if (media) {
        const token = createStreamToken({ u: url, f: formatId, p: media.proxyUsed ?? "", k: media.platformKey });
        statsStore.startDownload(fileId);
        statsStore.endDownload(fileId, { title: media.filename, platform });
        console.log(`[download] stream mode → ${platform} ${formatId}`);
        res.json({ downloadUrl: `/api/video/stream/${token}`, filename: media.filename, ext: media.ext });
        return;
      }
      // no progressive format → fall through to file mode
      console.log(`[download] ${platform}: no streamable URL — switching to file mode`);
    } catch (e: any) {
      const c = classifyError(e.message, platform);
      // If extraction itself failed with a hard error (private etc.), report it
      // instead of pointlessly retrying in file mode.
      if (c.code !== "UNKNOWN" && c.code !== "TIMEOUT") {
        res.status(c.status).json({ error: c.userMessage, code: c.code });
        return;
      }
      console.warn(`[download] stream resolution failed (${e.message?.slice(0, 100)}) — falling back to file mode`);
    }
  }

  // ── Legacy file mode ─────────────────────────────────────────────────────
  await fileDlSem.acquire();
  statsStore.startDownload(fileId);

  try {
    let finalFile: string;

    if (platform === "Instagram") {
      finalFile = await downloadInstagramFile(url, formatId, fileId);
    } else if (platform === "TikTok") {
      finalFile = await downloadTikTokFile(url, formatId, fileId);
    } else if (platform === "YouTube") {
      finalFile = await downloadYouTubeFile(url, formatId, fileId);
    } else {
      finalFile = await downloadGenericFile(url, formatId, fileId);
    }

    const ext = path.extname(finalFile).replace(".", "");
    statsStore.endDownload(fileId, { title: finalFile, platform });
    fileDlSem.release();
    res.json({ downloadUrl: `/api/video/file/${finalFile}`, filename: finalFile, ext });

  } catch (e: any) {
    statsStore.endDownload(fileId);
    fileDlSem.release();
    const c = classifyError(e.message, platform);
    res.status(c.status).json({ error: c.userMessage, code: c.code });
  }
});

// ── GET /api/video/stream/:token — pipe CDN → browser (Range-aware) ───────────
router.get("/stream/:token", async (req: Request, res: Response) => {
  const payload = verifyStreamToken(String(req.params.token));
  if (!payload) { res.status(410).json({ error: "This download link has expired. Please request the video again.", code: "TOKEN_EXPIRED" }); return; }

  let media = getCachedMedia(payload.u, payload.f);
  if (!media) {
    // Cached CDN URL expired — re-resolve once
    const platform = detectPlatform(payload.u);
    try {
      media = await resolveMediaUrl(payload.u, payload.f, platform, { strictHeight: platform === "YouTube" });
      if (media) cacheMedia(payload.u, payload.f, media);
    } catch { /* handled below */ }
    if (!media) { res.status(410).json({ error: "This download link has expired. Please request the video again.", code: "TOKEN_EXPIRED" }); return; }
  }

  const referer = STREAM_REFERER[media.platformKey];
  const range = req.headers.range as string | undefined;

  // YouTube CDN URLs are IP-bound to the extraction route; everything else is
  // fetched directly (keeps proxy bandwidth for extraction only) with a
  // proxy retry if the CDN refuses the direct connection.
  const wantProxyFirst = media.platformKey === "youtube";
  const attempts: Array<string | null> = wantProxyFirst
    ? [media.proxyUsed, null]
    : [null, media.proxyUsed];

  let upstream: http.IncomingMessage | null = null;
  for (const proxyUrl of attempts) {
    if (proxyUrl === undefined) continue;
    try {
      const r = await openUpstream(media.cdnUrl, { range, proxyUrl, referer });
      if (r.statusCode && r.statusCode < 400) { upstream = r; break; }
      r.destroy();
      console.warn(`[stream] upstream ${r.statusCode} via ${proxyUrl ? "proxy" : "direct"}`);
    } catch (err: any) {
      console.warn(`[stream] upstream error via ${proxyUrl ? "proxy" : "direct"}: ${err.message?.slice(0, 80)}`);
    }
  }

  if (!upstream) {
    res.status(502).json({ error: "Could not fetch the video from its source. Please try again.", code: "STREAM_FAILED" });
    return;
  }

  const ext = media.ext.toLowerCase();
  const ctMap: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4", mov: "video/quicktime" };
  const status = upstream.statusCode ?? 200;

  res.status(status === 206 ? 206 : 200);
  const ct = (upstream.headers["content-type"] as string) ?? ctMap[ext] ?? "application/octet-stream";
  if (!ct.includes("text/html")) res.setHeader("Content-Type", ct);
  if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"] as string);
  if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"] as string);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Disposition", contentDisposition(media.filename));
  res.setHeader("Cache-Control", "no-store");

  upstream.setTimeout(120_000, () => { upstream?.destroy(new Error("upstream idle timeout")); });
  req.on("close", () => { try { upstream?.destroy(); } catch {} });

  upstream.pipe(res);
  upstream.on("error", () => { try { res.destroy(); } catch {} });
});

// ── GET /api/video/file/:filename ─────────────────────────────────────────────
router.get("/file/:filename", (req: Request, res: Response) => {
  const { filename } = req.params as Record<string, string>;
  if (!filename || filename.includes("..") || /[/\\]/.test(filename) || filename.includes("\0")) { res.status(400).json({ error: "Invalid filename" }); return; }
  const filePath = path.join(downloadDir, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found or already downloaded" }); return; }

  const ext  = path.extname(filename).replace(".", "").toLowerCase();
  const ctMap: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4" };
  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", ctMap[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });
  stream.on("error", () => { try { fs.unlinkSync(filePath); } catch {} });
});

// ── Cleanup stale files every 10 min ─────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  try { for (const f of fs.readdirSync(downloadDir)) { const fp = path.join(downloadDir, f); try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {} } } catch {}
  const now = Date.now();
  for (const [k, v] of infoCache) { if (now > v.expiry) infoCache.delete(k); }
  for (const [k, v] of mediaCache) { if (now > v.expiry) mediaCache.delete(k); }
}, 10 * 60_000);

export default router;
