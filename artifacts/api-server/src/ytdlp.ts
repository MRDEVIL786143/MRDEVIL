/**
 * ytdlp.ts — yt-dlp binary resolution + shared arg builders.
 *
 * Hardening applied to every spawn:
 *   - forced IPv4 (Railway/VPS IPv6 routes are often broken or blocked)
 *   - retries for fragments + full downloads
 *   - concurrent HLS fragments for speed
 *   - global proxy pool + per-platform cookies injected by callers
 */

import fs from "fs";
import { spawn } from "child_process";
import { proxyPool } from "./proxy-pool.js";

// ── Binary path (resolved once) ───────────────────────────────────────────────
export const YT_DLP_PATH = (() => {
  const candidates = [
    process.env.YTDLP_PATH,
    "/usr/local/bin/yt-dlp",
    "/opt/venv/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/usr/local/python/current/bin/yt-dlp",
    "/data/data/com.termux/files/usr/bin/yt-dlp",
    "/home/runner/workspace/.pythonlibs/bin/yt-dlp",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) { console.log(`[yt-dlp] using: ${p}`); return p; }
  }
  console.warn("[yt-dlp] WARNING: yt-dlp not found in any expected path — falling back to PATH lookup");
  return "yt-dlp";
})();

const FORCE_IPV4 = process.env.YTDLP_IPV4 !== "0"; // default ON

// ── Proxy selection with per-platform override ────────────────────────────────
// TIKTOK_PROXIES / TIKTOK_PROXY stay TikTok-only for backwards compatibility;
// everything else falls back to the global pool.
export function proxyFor(platform: string): string | null {
  if (platform === "TikTok") {
    const p = (process.env.TIKTOK_PROXIES ?? process.env.TIKTOK_PROXY ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (p.length) return p[Math.floor(Math.random() * p.length)];
  }
  if (platform === "TikTok") {
    return proxyPool.getNext(); // global pool fallback
  }
  return proxyPool.getNext();
}

export function proxyArgs(proxyUrl: string | null): string[] {
  return proxyUrl ? ["--proxy", proxyUrl] : [];
}

// ── Base hardening args ───────────────────────────────────────────────────────
export function baseYtDlpArgs(platform?: string, proxyUrl: string | null = null): string[] {
  const args = [
    "--no-check-certificates",
    "--socket-timeout", "20",
    "--retries", "3",
    "--fragment-retries", "3",
    "--concurrent-fragments", "4",
    "--no-progress",
    ...proxyArgs(proxyUrl),
  ];
  if (FORCE_IPV4) args.push("--force-ipv4");
  void platform;
  return args;
}

// ── Process runner ────────────────────────────────────────────────────────────
export function runProcess(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d; });
    proc.stderr.on("data", (d: Buffer) => { stderr += d; });
    const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} reject(new Error("Request timed out")); }, timeoutMs);
    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim().startsWith("{")) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `Process exited with code ${code}`));
    });
    proc.on("error", err => { clearTimeout(timer); reject(new Error(`Spawn error: ${err.message}`)); });
  });
}

export const runYtDlp = (args: string[], ms = 30_000) => runProcess(YT_DLP_PATH, args, ms);

// ── JSON parse helper ─────────────────────────────────────────────────────────
export function parseYtDlpInfo(stdout: string): any | null {
  for (const line of stdout.trim().split("\n")) {
    const t = line.trim();
    if (t.startsWith("{")) { try { return JSON.parse(t); } catch {} }
  }
  return null;
}
