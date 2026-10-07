#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Ensure yt-dlp and instaloader are installed for the video downloader
if [ ! -f "/home/runner/workspace/.pythonlibs/bin/yt-dlp" ]; then
  echo "Installing yt-dlp and instaloader..."
  uv venv /home/runner/workspace/.pythonlibs --python python3 2>/dev/null || true
  uv pip install --python /home/runner/workspace/.pythonlibs/bin/python yt-dlp instaloader
fi
