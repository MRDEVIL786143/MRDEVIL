import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import router from "./routes";

const app: Express = express();

// Railway / PaaS reverse proxies terminate TLS and forward via X-Forwarded-For —
// trust it so per-IP rate limiting sees the real client IP.
app.set("trust proxy", true);

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-session-id"],
  credentials: false,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// ── Per-IP rate limiter (sliding window, production-grade) ────────────────────
// Separate buckets for /info (heavier TikTok calls) and /download (file I/O)
interface RateBucket { count: number; resetAt: number; }
const rateLimitMap = new Map<string, { info: RateBucket; download: RateBucket }>();
const RATE_WINDOW_MS = 60_000;

// Conservative limits per IP — generous enough for real users, tight enough
// to prevent one IP from hammering TikTok on behalf of everyone else.
const LIMITS = { info: 20, download: 10 };  // per minute per IP

function getIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string)?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function rateLimitMiddleware(
  bucket: "info" | "download",
  limit: number,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getIp(req);
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry) {
      entry = {
        info:     { count: 0, resetAt: now + RATE_WINDOW_MS },
        download: { count: 0, resetAt: now + RATE_WINDOW_MS },
      };
      rateLimitMap.set(ip, entry);
    }

    const b = entry[bucket];
    if (now > b.resetAt) {
      b.count = 0;
      b.resetAt = now + RATE_WINDOW_MS;
    }

    if (b.count >= limit) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfter} seconds and try again.`,
        code:  "RATE_LIMIT",
        retryAfter,
      });
      return;
    }

    b.count++;
    next();
  };
}

// Apply per-endpoint rate limits
app.use("/api/video/info",     rateLimitMiddleware("info",     LIMITS.info));
app.use("/api/video/download", rateLimitMiddleware("download", LIMITS.download));

// Prune stale entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.info.resetAt && now > entry.download.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Static frontend (single-service deploys, e.g. Railway Dockerfile) ─────────
// When WEB_DIST exists, serve the built React app with an SPA fallback so the
// whole product runs from ONE Railway service.
const WEB_DIST = process.env.WEB_DIST || path.resolve(process.cwd(), "../../web-dist");
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  console.log(`[app] serving frontend from ${WEB_DIST}`);
  app.use(express.static(WEB_DIST, { index: "index.html", maxAge: "1d", setHeaders: (res, p) => { if (p.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache"); } }));
  // SPA fallback — keep /api 404s as JSON
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[app] unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
