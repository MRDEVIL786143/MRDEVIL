# ─────────────────────────────────────────────────────────────────────────────
# MR DEVIL VIDEO DOWNLOADER — production image (Railway-ready)
# Node 22 API + React frontend build, Python 3 + yt-dlp + ffmpeg for extraction
# Deploy: push this repo to GitHub → Railway "New Project → Deploy from repo"
# (Railway auto-detects the Dockerfile) → set env vars → done.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# System deps: python3 + pip (yt-dlp), ffmpeg (merging/MP3), ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp into a venv (Debian slim blocks system pip installs)
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -U yt-dlp
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install workspace dependencies (cached layer)
COPY pnpm-workspace.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/video-downloader/package.json artifacts/video-downloader/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/db/package.json lib/db/
RUN pnpm install

# Copy sources
COPY artifacts/ artifacts/
COPY lib/ lib/
COPY scripts/ scripts/

# Build the frontend (vite) into /app/web-dist — the API server serves it,
# so the whole product runs from ONE Railway service.
RUN pnpm --filter video-downloader run build \
  && mkdir -p /app/web-dist \
  && cp -r artifacts/video-downloader/dist/. /app/web-dist/

# Build the API server bundle (esbuild → dist/index.cjs)
RUN pnpm --filter api-server run build

ENV NODE_ENV=production \
    PORT=3001 \
    YTDLP_PATH=/opt/venv/bin/yt-dlp \
    WEB_DIST=/app/web-dist

EXPOSE 3001

# entrypoint: refresh yt-dlp (platforms change APIs often) then start
CMD ["sh", "-c", "/opt/venv/bin/pip install -q -U yt-dlp 2>/dev/null; node artifacts/api-server/dist/index.cjs"]
