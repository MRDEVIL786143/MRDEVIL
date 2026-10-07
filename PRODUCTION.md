# MR DEVIL VIDEO DOWNLOADER — Production Upgrade Guide

## Deploying on Railway (fixes "downloads fail on server IPs")

### Why downloads failed

Railway gives your service a **datacenter IP**. YouTube answers with
*"Sign in to confirm you're not a bot"*, TikTok serves a captcha, Instagram
shows a login wall — all targeted at datacenter ranges. Locally (your home IP)
everything worked, which is why the breakage only appears after deploying.

This release fixes it with a defense-in-depth stack:

| Layer | What it does | Env var |
|---|---|---|
| 1. Global proxy pool | Rotates residential proxies for **every** platform, health-tracks them, benches failing ones for 5 min and self-heals | `PROXIES` |
| 2. Platform cookies | Sends your logged-in session cookies to YouTube/TikTok/FB/X/Reddit — kills bot walls | `YOUTUBE_COOKIES` / `YOUTUBE_COOKIES_URL` / … |
| 3. YouTube client rotation | Tries `web_safari`, `tv_embedded`, `web_embedded`, `mweb` extractors — several work without PO tokens from DC IPs | automatic |
| 4. Cobalt fallback | Optional external extractor service as last resort for every platform | `COBALT_API_URL` |
| 5. RapidAPI fallback | TikTok scraper API as last resort | `RAPIDAPI_KEY` |
| 6. IPv4 forcing | `--force-ipv4` fixes broken IPv6 egress on some hosts | `YTDLP_IPV4` |

### Streaming architecture (scales to hundreds of users)

Before: the server downloaded the **entire file** with yt-dlp to a temp file
(3 concurrent max), then served it. Two full bandwidth passes, heavy disk churn,
and users waited for the whole download before theirs even started.

Now: `POST /api/video/download` extracts the **direct CDN URL** and returns a
signed streaming link (`/api/video/stream/:token`). The server pipes the CDN
stream straight to the browser with **Range/resume support** — zero temp disk,
instant start, and the number of concurrent downloads is no longer bounded by
the yt-dlp pool. The temp-file flow is kept only for MP3 conversion, YouTube
DASH merging (>720p), and as an automatic fallback.

### Deploy steps

1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** — the included
   `Dockerfile` + `railway.json` are auto-detected (Node 22 + Python + yt-dlp
   + ffmpeg, frontend served by the same service).
3. Add a **Volume** (e.g. mount path `/data`) and set `DATA_DIR=/data` so stats
   survive redeploys.
4. Set variables (minimum recommended):

   ```
   DATA_DIR=/data
   PROXIES=http://user:pass@p.webshare.io:80
   YOUTUBE_COOKIES_URL=https://gist.githubusercontent.com/you/.../cookies.txt
   RAPIDAPI_KEY=...
   ```

5. Verify with `https://your-app.up.railway.app/api/video/status` — it shows
   yt-dlp version, proxy pool health, cookie configuration and concurrency.

### Getting residential proxies (5 minutes)

Any provider works — the pool speaks `http://`, `https://` and `socks5://`:

- **Webshare** — 10 free proxies forever: dashboard → Proxy → copy
  `http://user:pass@p.webshare.io:80`
- **IPRoyal** — pay-as-you-go residential, single rotating gateway URL
- **Bright Data** — rotating gateway, big volume

Paste one or more URLs into `PROXIES` (comma-separated). Rotating gateway
URLs count as one entry and rotate on their side.

### YouTube cookies (kills the bot wall)

1. Install the **"Get cookies.txt LOCALLY"** browser extension.
2. Log into youtube.com, export cookies.
3. Upload the file to a **private** GitHub Gist → Raw URL (or S3).
4. Set `YOUTUBE_COOKIES_URL=<raw url>` — it's re-fetched every 6 h.

⚠️ Use a throwaway Google account; aggressive scraping can expire cookies.

### Health & diagnostics endpoints

| Endpoint | Shows |
|---|---|
| `GET /api/video/status` | yt-dlp version, proxy pool health, cookies, cobalt/rapidapi config, queue depth |
| `GET /api/video/instagram-status` | IG cookie pool state |
| `GET /healthz` | liveness (used by Railway healthcheck) |

## What Changed (Summary)

| Area | Before | After |
|---|---|---|
| Download transport | Full temp-file download (3 parallel max) | **Streaming CDN pipe** (no temp disk, Range/resume) + file flow for MP3/merge |
| Proxies | TikTok/Instagram only | **Global pool, all platforms**, health tracking + cooldown |
| YouTube | Single extractor client | **Client rotation** + cookies + optional Cobalt fallback |
| Cookies | Instagram only | **All platforms** via env or remote cookies.txt URL |
| TikTok fallback | 6 providers (A–F) | **7 providers** (A–G, adds RapidAPI), webpage scrape now proxied |
| Concurrency | Hardcoded 3 downloads | `MAX_PARALLEL_EXTRACTIONS=6` + `MAX_PARALLEL_DOWNLOADS=4` (streaming unbounded) |
| Rate limiter | Single bucket for all routes | **Separate buckets**: 20/min info, 10/min downloads |
| Download counter | **Fake seeded data** (1284 base + random) | **Real persistent counter** (0-based, file-backed) |
| Stats storage | In-memory only (resets on restart) | JSON files survive restarts (`DATA_DIR`) |
| Reviews | 6 seeded fake reviews | Real user reviews persisted to disk |
| Trending | 5 fake hardcoded entries | Only real downloaded videos appear |
| `totalAllTime` | Not tracked | Persisted across restarts |

---

## Quick Start (local)

```bash
# Install dependencies
pnpm install

# Set env vars (minimum)
export PORT=3001
export DATA_DIR=./data          # where stats/reviews JSON live

# Optional — boosts TikTok success rate significantly
export RAPIDAPI_KEY=your_key_here

# Run
cd artifacts/api-server && pnpm dev
```

---

## Environment Variables

### Required
| Var | Description |
|---|---|
| `PORT` | HTTP port to bind (e.g. `3001`) |

### Strongly Recommended
| Var | Description |
|---|---|
| `DATA_DIR` | Path to persist `stats.json` and `reviews.json`. Defaults to OS temp (lost on restart). Set to a volume mount in Docker. |
| `RAPIDAPI_KEY` | Free RapidAPI key for TikTok-Scraper7 (500 req/month free). Acts as Provider G fallback when all yt-dlp providers are rate-limited. Get it at https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7 |

### TikTok Proxies (optional but highly recommended for 1000+ users)
| Var | Description |
|---|---|
| `TIKTOK_PROXIES` | Comma-separated proxy URLs: `http://user:pass@p1:port,http://user:pass@p2:port` |
| `TIKTOK_PROXY` | Single proxy (alias for `TIKTOK_PROXIES` with one entry) |

### Instagram (optional)
| Var | Description |
|---|---|
| `INSTAGRAM_SESSION_ID` | Raw `sessionid` cookie value from an Instagram account |
| `INSTAGRAM_COOKIES` | Full cookie string |
| `INSTAGRAM_COOKIES_FILE` | Path to Netscape cookies.txt |

---

## Scaling for 1000+ Users

### The TikTok Rate Limit Problem

TikTok rate-limits by server IP, not per-user. When 1000 users hit the same server,
all their TikTok requests share **one IP address's quota**. The solution is layered:

1. **Caching** — identical URLs served from cache for 10 min (already in code)
2. **Serialization** — TikTok requests queue 1-at-a-time (already in code)
3. **7 providers** — A–F (yt-dlp strategies + webpage scraping) + G (RapidAPI)
4. **Proxies** — route yt-dlp through residential proxies → each has its own quota

### Recommended Production Architecture

```
Nginx (reverse proxy + static assets)
  └── Node.js API server (2–4 instances via PM2)
        └── Shared DATA_DIR (NFS/volume)
        └── Redis (optional: replace in-memory cache for multi-instance)
```

### PM2 Config (ecosystem.config.cjs)

```js
module.exports = {
  apps: [{
    name: "fvd-api",
    script: "./artifacts/api-server/dist/index.js",
    instances: 2,          // 2 workers for parallel downloads
    exec_mode: "fork",     // NOT cluster (yt-dlp spawns child processes)
    env: {
      PORT: 3001,
      DATA_DIR: "/var/data/fvd",
      RAPIDAPI_KEY: "your_key",
      TIKTOK_PROXIES: "http://p1:port,http://p2:port",
    },
  }]
};
```

> **Note:** With multiple instances, `DATA_DIR` should be on shared storage so
> download counts aren't split across processes. If you can't share storage,
> use a database (SQLite with WAL mode works fine for small deployments).

### Docker Deployment

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install
RUN cd artifacts/api-server && pnpm build

ENV PORT=3001
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "artifacts/api-server/dist/index.js"]
```

```yaml
# docker-compose.yml
services:
  fvd:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - fvd_data:/data
    environment:
      PORT: 3001
      DATA_DIR: /data
      RAPIDAPI_KEY: ${RAPIDAPI_KEY}
      TIKTOK_PROXIES: ${TIKTOK_PROXIES}
    restart: unless-stopped

volumes:
  fvd_data:
```

---

## API Routes Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/healthz` | Health check (alternate) |
| `POST` | `/api/video/info` | Get video metadata + formats |
| `POST` | `/api/video/download` | Download video, returns file URL |
| `GET` | `/api/video/file/:filename` | Serve + delete temp file |
| `GET` | `/api/video/instagram-status` | Cookie pool status |
| `POST` | `/api/video/instagram-cookies` | Save IG session cookie |
| `GET` | `/api/stats` | Live stats (real downloads) |
| `GET` | `/api/stats/trending` | Top downloaded videos |
| `GET` | `/api/stats/platforms` | Per-platform download counts |
| `GET` | `/api/stats/ratings` | Reviews |
| `POST` | `/api/stats/ratings` | Submit review |
| `POST` | `/api/stats/ratings/:id/react` | Like/dislike review |

### Rate Limits (per IP per minute)
- `/api/video/info` → **20 requests/min**
- `/api/video/download` → **10 requests/min**

---

## Getting a Free RapidAPI Key (TikTok Provider G)

1. Go to https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7
2. Sign up / log in (free)
3. Click **Subscribe** → select **Basic (Free)** — 500 req/month
4. Copy your `X-RapidAPI-Key` from the "Header Parameters" panel
5. Set `RAPIDAPI_KEY=your_key` in your `.env`

This becomes Provider G — only used when all 6 yt-dlp strategies fail.
It's your last line of defence against TikTok rate-limits.
