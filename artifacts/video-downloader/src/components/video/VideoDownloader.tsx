import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Search, Loader2, Download, AlertCircle, PlayCircle,
  Music, Video, X, RefreshCw, CheckCircle2, Clock, Zap,
  Key, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";
import { useGetVideoInfo, useDownloadVideo } from "@workspace/api-client-react";
import { PlatformIcon } from "./PlatformIcon";
import { formatDuration, cn } from "@/lib/utils";

const BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
const VIDEO_API = `${BASE}/api/video`;

// ── Quality colour map ────────────────────────────────────────────────────────
const QUALITY_COLORS: Record<string, string> = {
  "4K (2160p)": "from-yellow-500 to-amber-500 shadow-yellow-500/25 border-yellow-500/30",
  "1440p":      "from-emerald-500 to-teal-500 shadow-emerald-500/25 border-emerald-500/30",
  "1080p":      "from-purple-600 to-indigo-600 shadow-purple-500/25 border-purple-500/30",
  "720p":       "from-blue-500 to-cyan-500 shadow-blue-500/25 border-blue-500/30",
  "480p":       "from-slate-500 to-slate-600 shadow-slate-500/20 border-slate-500/30",
  "360p":       "from-slate-600 to-slate-700 shadow-slate-600/20 border-slate-600/30",
  "240p":       "from-slate-700 to-slate-800 shadow-slate-700/20 border-slate-600/30",
  "144p":       "from-slate-700 to-slate-800 shadow-slate-700/20 border-slate-600/30",
};

// ── Error code → hint map ─────────────────────────────────────────────────────
const ERROR_HINTS: Record<string, string> = {
  PRIVATE:          "This video is private or requires login.",
  NOT_FOUND:        "Video not found — it may have been deleted.",
  RATE_LIMIT:       "Too many requests. Wait 30 seconds and try again.",
  IG_RATE:          "Instagram is temporarily limiting requests. Wait 30 seconds and retry.",
  GEO_BLOCK:        "This video is not available in this region.",
  COPYRIGHT:        "This video is blocked due to copyright restrictions.",
  UNSUPPORTED:      "No downloadable video found at this URL.",
  TIMEOUT:          "Request timed out — please try again.",
  NETWORK:          "Network error. Check your connection and try again.",
  IG_AUTH:          "Instagram requires a session cookie to download — even for public posts. Add your session cookie below to continue.",
  INVALID_URL:      "That doesn't look like a valid video URL.",
  IN_FLIGHT:        "Already processing — please wait.",
  TT_RATE:          "TikTok is busy and rate-limiting requests. The app will retry automatically.",
  TT_PRIVATE:       "This TikTok video is private or friends-only.",
  TT_NOT_FOUND:     "TikTok video not found — it may have been deleted or the link is broken.",
  TT_EXTRACT_FAIL:  "Could not extract this TikTok video. Check that the link is public and try again.",
  BOT_CHECK:        "The platform challenged this request (bot check). Retrying usually helps — if it persists, the server operator needs to refresh cookies or proxies.",
  TOKEN_EXPIRED:    "Your download link expired. Tap the quality button again to get a fresh link.",
  STREAM_FAILED:    "Couldn't fetch the video from its source. Please try again.",
  PROXY_EXHAUSTED:  "All proxy routes are currently cooling down. Please retry in a few minutes.",
};

function friendlyError(err: any): string {
  // orval fetch client throws ApiError with parsed body on `.data`;
  // older axios-style checks kept for safety.
  const body = err?.data ?? err?.response?.data ?? {};
  const code = (body?.code ?? err?.code) as string | undefined;
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code];
  return (body?.error as string) || err?.message || "Could not fetch this video. Check the URL and try again.";
}

// ── URL utilities ─────────────────────────────────────────────────────────────
function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s"'<>)）]+/i);
  return m ? m[0].replace(/[.,;!?）\]]+$/, "").trim() : text.trim();
}

function cleanInput(val: string): string {
  if (val.includes(" ") && /https?:\/\//i.test(val)) return extractUrl(val);
  return val;
}

// ── Fetch steps copy ──────────────────────────────────────────────────────────
const FETCH_STEPS_DEFAULT = ["Connecting…", "Fetching video info…", "Parsing formats…"];
const FETCH_STEPS_TIKTOK  = [
  "Connecting to TikTok…",
  "Fetching video info…",
  "Trying backup extractor if rate-limited…",
  "Parsing formats…",
];
function getFetchSteps(url: string): string[] {
  return url.toLowerCase().includes("tiktok") ? FETCH_STEPS_TIKTOK : FETCH_STEPS_DEFAULT;
}

// ── Instagram Cookie Panel ────────────────────────────────────────────────────
function InstagramCookiePanel({ onSaved }: { onSaved: () => void }) {
  const [sessionId, setSessionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const handleSave = async () => {
    const val = sessionId.trim();
    if (!val) return;
    setSaving(true);
    try {
      const r = await fetch(`${VIDEO_API}/instagram-cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionid: val }),
      });
      if (r.ok) {
        toast.success("Cookie saved!", { description: "Instagram downloads are now enabled. Retrying…" });
        setSessionId("");
        onSaved();
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error("Failed to save cookie", { description: d.error || "Try again." });
      }
    } catch {
      toast.error("Network error saving cookie.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      key="ig-cookie-panel"
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden mt-3"
    >
      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-amber-300 text-sm font-semibold">Instagram Session Cookie Required</p>
        </div>

        <p className="text-slate-400 text-xs leading-relaxed">
          Instagram blocks server-side requests (even for public posts) without a valid session cookie.
          Paste your <code className="bg-white/10 px-1 rounded text-amber-300">sessionid</code> below to enable downloads.
        </p>

        <button
          onClick={() => setShowSteps(s => !s)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {showSteps ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          How to get my session cookie?
        </button>

        <AnimatePresence>
          {showSteps && (
            <motion.ol
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden text-xs text-slate-400 space-y-1 pl-4 list-decimal"
            >
              <li>Open <a href="https://www.instagram.com" target="_blank" rel="noopener" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">instagram.com <ExternalLink className="w-3 h-3" /></a> and log in</li>
              <li>Press <kbd className="bg-white/10 px-1 rounded">F12</kbd> to open DevTools</li>
              <li>Go to <strong className="text-slate-300">Application</strong> → <strong className="text-slate-300">Cookies</strong> → <code className="bg-white/10 px-1 rounded">https://www.instagram.com</code></li>
              <li>Find <code className="bg-white/10 px-1 rounded text-amber-300">sessionid</code> and copy its <strong className="text-slate-300">Value</strong></li>
              <li>Paste it below and click Save</li>
            </motion.ol>
          )}
        </AnimatePresence>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste your sessionid value here…"
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={handleSave}
            disabled={!sessionId.trim() || saving}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function VideoDownloader() {
  const [url, setUrl] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [fetchStep, setFetchStep] = useState(0);
  const [showIgPanel, setShowIgPanel] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const lastFetchedUrl = useRef<string>("");
  const cooldown = useRef(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryAttempts = useRef(0);

  const {
    mutate: fetchInfo,
    isPending: isFetching,
    data: videoInfo,
    error: fetchError,
    reset: resetInfo,
  } = useGetVideoInfo();

  const { mutate: downloadVideo } = useDownloadVideo();

  // ── Fetch step animation ─────────────────────────────────────────────────
  const startStepCycle = () => {
    setFetchStep(0);
    if (stepTimer.current) clearInterval(stepTimer.current);
    stepTimer.current = setInterval(() => {
      setFetchStep(s => Math.min(s + 1, getFetchSteps(url).length - 1));
    }, 2500);
  };
  const stopStepCycle = () => {
    if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; }
  };

  // Safety cleanup on unmount
  useEffect(() => () => {
    if (stepTimer.current)   clearInterval(stepTimer.current);
    if (retryTimerRef.current) clearInterval(retryTimerRef.current);
  }, []);

  // Keep-alive ping — prevents Replit container from going idle
  useEffect(() => {
    const ping = () => fetch(`${BASE}/api/healthz`, { method: "GET", keepalive: true }).catch(() => {});
    ping(); // immediate ping on mount
    const id = setInterval(ping, 90_000);
    return () => clearInterval(id);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    const extracted = extractUrl(pasted);
    if (extracted !== pasted.trim()) {
      e.preventDefault();
      setUrl(extracted);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(cleanInput(e.target.value));
  };

  const clearInput = () => {
    setUrl("");
    resetInfo();
    setShowIgPanel(false);
    lastFetchedUrl.current = "";
    stopStepCycle();
    if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    setRetryCountdown(null);
    retryAttempts.current = 0;
  };

  const handleFetch = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const cleaned = extractUrl(url);
      if (!cleaned || isFetching || cooldown.current) return;
      if (cleaned === lastFetchedUrl.current && videoInfo) {
        toast.info("Already loaded", { description: "This video is already displayed below." });
        return;
      }

      // Cancel any in-progress auto-retry countdown
      if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
      setRetryCountdown(null);
      retryAttempts.current = 0;

      cooldown.current = true;
      setTimeout(() => { cooldown.current = false; }, 1500);

      lastFetchedUrl.current = cleaned;
      setUrl(cleaned);
      setDownloadingId(null);
      setShowIgPanel(false);
      resetInfo();
      startStepCycle();

      // Inner recursive helper — handles auto-retry on TT_RATE
      const runFetch = (targetUrl: string) => {
        fetchInfo({ data: { url: targetUrl } }, {
          onSettled: () => stopStepCycle(),
          onError: (err: any) => {
            const code = err?.response?.data?.code as string | undefined;
            if (code === "IG_AUTH") { setShowIgPanel(true); return; }

            // Auto-retry on any transient TikTok failure (rate limit OR extraction error).
            // The server now returns `retryAfter` (seconds) based on its 30s/60s/90s
            // backoff schedule — use that when available, fall back to safe defaults.
            const isTransientTikTok = code === "TT_RATE" || code === "TT_EXTRACT_FAIL";
            // Allow up to 5 retries to cover the full 6-level backoff schedule
            // (3 s → 8 s → 15 s → 30 s → 60 s → 90 s).
            const maxRetries = code === "TT_RATE" ? 5 : 2;
            if (isTransientTikTok && retryAttempts.current < maxRetries) {
              const attempt = ++retryAttempts.current;
              // Use the server's authoritative retryAfter when available; the server
              // already added jitter so we can use the value directly.
              const serverRetryAfter = err?.response?.data?.retryAfter as number | undefined;
              const fallbackSchedule = [3, 8, 15, 30, 60, 90];
              const waitSecs = serverRetryAfter
                ?? (code === "TT_RATE"
                  ? (fallbackSchedule[attempt - 1] ?? 90)
                  : (attempt === 1 ? 5 : 8));
              let remaining = waitSecs;
              setRetryCountdown(remaining);

              retryTimerRef.current = setInterval(() => {
                remaining--;
                setRetryCountdown(remaining);
                if (remaining <= 0) {
                  if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
                  setRetryCountdown(null);
                  lastFetchedUrl.current = "";
                  startStepCycle();
                  runFetch(targetUrl);
                }
              }, 1000);
              return;
            }

            // All retries exhausted — show user-friendly error (never raw HTTP text)
            retryAttempts.current = 0;
            toast.error("Could not load video", { description: friendlyError(err), duration: 7000 });
          },
        });
      };

      runFetch(cleaned);
    },
    [url, isFetching, videoInfo, fetchInfo, resetInfo]
  );

  const triggerDownload = useCallback(
    (formatId: string, quality: string) => {
      if (downloadingId) return;
      const cleaned = extractUrl(url);
      if (!cleaned) return;

      setDownloadingId(formatId);

      const dlToast = toast.loading(`Downloading ${quality}…`, { description: "Please wait, this may take a moment." });

      downloadVideo(
        { data: { url: cleaned, formatId } },
        {
          onSuccess: data => {
            setDownloadingId(null);
            toast.dismiss(dlToast);
            toast.success(`${quality} downloaded!`, {
              description: "Your file has been saved to downloads.",
              duration: 5000,
            });
            const a = document.createElement("a");
            a.href = data.downloadUrl;
            a.download = data.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          },
          onError: (err: any) => {
            setDownloadingId(null);
            toast.dismiss(dlToast);
            toast.error("Download failed", { description: friendlyError(err), duration: 6000 });
          },
        }
      );
    },
    [downloadingId, url, downloadVideo]
  );

  const handleRetry = () => {
    lastFetchedUrl.current = "";
    resetInfo();
    handleFetch();
  };

  const videoFormats = videoInfo?.formats.filter(f => f.hasVideo) ?? [];
  const audioFormats = videoInfo?.formats.filter(f => !f.hasVideo && f.hasAudio) ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-3xl mx-auto z-10 relative">

      {/* ── URL Input ─────────────────────────────────────────────────────── */}
      <motion.form
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        onSubmit={handleFetch}
        className="relative group"
      >
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-20 group-hover:opacity-35 group-focus-within:opacity-40 transition duration-500 pointer-events-none" />
        <div className="relative flex items-center w-full glass-panel rounded-2xl p-2 gap-1">
          <div className="pl-3 pr-1 shrink-0">
            {isFetching ? (
              <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            ) : url ? (
              <PlatformIcon url={url} className="w-5 h-5" />
            ) : (
              <Search className="w-5 h-5 text-slate-500" />
            )}
          </div>

          <input
            type="text"
            placeholder="Paste video URL (YouTube, TikTok, Instagram…)"
            value={url}
            onChange={handleChange}
            onPaste={handlePaste}
            className="flex-1 min-w-0 bg-transparent border-none text-white placeholder:text-slate-500 focus:outline-none focus:ring-0 text-base sm:text-lg py-3.5 sm:py-4 px-2"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            inputMode="url"
          />

          {url && !isFetching && (
            <button
              type="button"
              onClick={clearInput}
              className="p-2 text-slate-500 hover:text-slate-300 transition-colors rounded-lg hover:bg-white/5 shrink-0"
              aria-label="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            type="submit"
            disabled={!url.trim() || isFetching}
            className="bg-gradient-primary text-white font-semibold px-5 sm:px-7 py-3 sm:py-3.5 rounded-xl shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:brightness-110 active:scale-95 shrink-0 min-w-[100px] sm:min-w-[130px] justify-center"
          >
            {isFetching
              ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="hidden sm:inline">Fetching…</span></>
              : <><Zap className="w-4 h-4" /><span>Process</span></>}
          </button>
        </div>
      </motion.form>

      {/* ── Fetch error ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {fetchError && !isFetching && retryCountdown === null && (
          <motion.div
            key="fetch-err"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-4"
          >
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-red-200 text-sm font-medium leading-snug">{friendlyError(fetchError)}</p>
              </div>
              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors shrink-0 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Instagram cookie panel (shown on IG_AUTH errors) ──────────────── */}
      <AnimatePresence>
        {showIgPanel && !isFetching && retryCountdown === null && (
          <InstagramCookiePanel
            onSaved={() => {
              setShowIgPanel(false);
              handleRetry();
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Loading skeleton (also shown during auto-retry countdown) ────── */}
      <AnimatePresence>
        {(isFetching || retryCountdown !== null) && (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-8 glass-panel rounded-2xl overflow-hidden"
          >
            <div className="flex flex-col sm:flex-row animate-pulse">
              <div className="w-full sm:w-2/5 min-h-[160px] bg-slate-800/60" />
              <div className="p-5 sm:p-6 w-full sm:w-3/5 space-y-4 bg-slate-900/50">
                <div className="h-4 bg-slate-700/60 rounded-lg w-3/4" />
                <div className="h-3 bg-slate-700/40 rounded-lg w-1/3" />
                <div className="flex items-center gap-2 mt-1">
                  <Clock className="w-3.5 h-3.5 text-purple-400 animate-spin" style={{ animationDuration: "3s" }} />
                  <span className="text-xs text-slate-500 transition-all">
                    {retryCountdown !== null
                      ? `TikTok is busy, waiting ${retryCountdown}s before retry…`
                      : getFetchSteps(url)[fetchStep]}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-10 bg-slate-700/40 rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Result panel ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {videoInfo && !isFetching && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-8 glass-panel rounded-2xl overflow-hidden"
          >
            <div className="flex flex-col sm:flex-row">
              {/* Thumbnail */}
              <div className="w-full sm:w-2/5 relative bg-slate-900 aspect-video sm:aspect-auto min-h-[160px] max-h-[280px]">
                {videoInfo.thumbnail ? (
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    className="w-full h-full object-cover opacity-80"
                    loading="lazy"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-900/80">
                    <PlayCircle className="w-12 h-12 text-slate-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-3 left-3 flex items-center gap-2 flex-wrap">
                  <span className="bg-slate-950/80 backdrop-blur-md text-xs font-semibold px-2 py-1 rounded-md text-slate-200 border border-white/10">
                    {videoInfo.platform}
                  </span>
                  {videoInfo.duration && (
                    <span className="bg-slate-950/80 backdrop-blur-md text-xs font-semibold px-2 py-1 rounded-md text-slate-200 border border-white/10">
                      {formatDuration(videoInfo.duration)}
                    </span>
                  )}
                </div>
              </div>

              {/* Info + buttons */}
              <div className="p-4 sm:p-5 w-full sm:w-3/5 flex flex-col gap-4 bg-slate-900/50">
                <div>
                  <h3
                    className="text-sm sm:text-base font-bold text-white line-clamp-2 leading-snug mb-1.5"
                    title={videoInfo.title}
                  >
                    {videoInfo.title}
                  </h3>
                  {videoInfo.uploader && (
                    <p className="text-slate-400 text-xs flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs text-white shrink-0 font-bold">
                        {videoInfo.uploader.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate">{videoInfo.uploader}</span>
                    </p>
                  )}
                </div>

                {/* Video quality buttons */}
                {videoFormats.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5 font-medium">
                      <Video className="w-3.5 h-3.5 text-slate-400" />
                      Video Quality
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {videoFormats.map(f => {
                        const color = QUALITY_COLORS[f.quality] ?? "from-slate-600 to-slate-700 shadow-slate-600/20 border-slate-600/30";
                        const isLoading = downloadingId === f.formatId;
                        return (
                          <motion.button
                            key={f.formatId}
                            whileTap={!downloadingId ? { scale: 0.94 } : {}}
                            onClick={() => triggerDownload(f.formatId, f.quality)}
                            disabled={!!downloadingId}
                            className={cn(
                              "flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-sm transition-all border text-white select-none",
                              isLoading
                                ? "opacity-70 cursor-wait bg-white/5 border-white/10"
                                : `bg-gradient-to-br ${color} shadow-md hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed`
                            )}
                          >
                            {isLoading
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Download className="w-3.5 h-3.5" />}
                            <span className="truncate">{isLoading ? "…" : f.quality}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Audio buttons */}
                {audioFormats.map(f => {
                  const isLoading = downloadingId === f.formatId;
                  return (
                    <motion.button
                      key={f.formatId}
                      whileTap={!downloadingId ? { scale: 0.98 } : {}}
                      onClick={() => triggerDownload(f.formatId, "MP3 Audio")}
                      disabled={!!downloadingId}
                      className={cn(
                        "w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition-all border select-none",
                        isLoading
                          ? "bg-pink-600/20 border-pink-500/40 text-pink-300 cursor-wait"
                          : "bg-gradient-to-br from-pink-600 to-rose-600 hover:brightness-110 border-pink-500/30 text-white shadow-md shadow-pink-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      )}
                    >
                      {isLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Converting to MP3…</>
                        : <><Music className="w-4 h-4" />Download MP3 (Audio Only)</>}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
