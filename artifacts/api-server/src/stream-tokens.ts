/**
 * stream-tokens.ts — HMAC-signed, expiring tokens for the streaming endpoint.
 *
 * POST /download returns { downloadUrl: "/api/video/stream/<token>" }. The
 * token encodes what to download and which proxy was used for extraction
 * (media CDNs like googlevideo bind URLs to the requesting IP, so the stream
 * must egress via the same route the extraction used).
 *
 * Tokens auto-expire (default 30 min) and are invalidated on restart unless
 * STREAM_SECRET is pinned — both are safe behaviours.
 */

import crypto from "crypto";

const SECRET = process.env.STREAM_SECRET || crypto.randomBytes(32).toString("hex");
const TTL_MS = Number(process.env.STREAM_TOKEN_TTL_MIN ?? 30) * 60_000;

export interface StreamPayload {
  /** Source page URL */
  u: string;
  /** formatId like __q_1080__ / __mp3__ / direct */
  f: string;
  /** proxy URL used for extraction ("" = direct) */
  p?: string;
  /** platform key */
  k: string;
  /** expiry (epoch ms) */
  e: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createStreamToken(payload: Omit<StreamPayload, "e">): string {
  const full: StreamPayload = { ...payload, e: Date.now() + TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(full), "utf8"));
  return `${body}.${sign(body)}`;
}

export function verifyStreamToken(token: string): StreamPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamPayload;
    if (!payload.u || !payload.f || Date.now() > payload.e) return null;
    return payload;
  } catch {
    return null;
  }
}
