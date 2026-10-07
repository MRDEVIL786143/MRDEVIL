import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

// ── Persistent storage path ───────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(os.tmpdir(), "fvd-data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DownloadRecord {
  title: string;
  platform: string;
  count: number;
  lastDownloaded: number;
}

export interface Review {
  id: string;
  stars: number;
  review: string;
  platform: string;
  author: string;
  timestamp: number;
  likes: number;
  dislikes: number;
}

interface PersistedStats {
  totalAllTime: number;
  downloadsToday: number;
  lastResetDate: string;
  platformCounts: Record<string, number>;
  trending: Record<string, DownloadRecord>;
}

// ── Load persisted stats ──────────────────────────────────────────────────────
function loadStats(): PersistedStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    }
  } catch {}
  // First-run defaults — start from 0, no fake seeding
  return {
    totalAllTime: 0,
    downloadsToday: 0,
    lastResetDate: new Date().toDateString(),
    platformCounts: {
      YouTube: 0, TikTok: 0, Instagram: 0, Facebook: 0,
      "Twitter/X": 0, Reddit: 0, Vimeo: 0, Pinterest: 0, Other: 0,
    },
    trending: {},
  };
}

function loadReviews(): Review[] {
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      return JSON.parse(fs.readFileSync(REVIEWS_FILE, "utf8"));
    }
  } catch {}
  return [];
}

// ── Save helpers (debounced, non-blocking) ────────────────────────────────────
let saveStatsTimer: ReturnType<typeof setTimeout> | null = null;
let saveReviewsTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveStats() {
  if (saveStatsTimer) return;
  saveStatsTimer = setTimeout(() => {
    saveStatsTimer = null;
    try {
      const data: PersistedStats = {
        totalAllTime: state.totalAllTime,
        downloadsToday: state.downloadsToday,
        lastResetDate: state.lastResetDate,
        platformCounts: Object.fromEntries(state.platformCounts),
        trending: Object.fromEntries(state.trendingMap),
      };
      fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.warn("[stats] failed to persist stats:", e);
    }
  }, 3_000); // write 3 s after last change
}

function scheduleSaveReviews() {
  if (saveReviewsTimer) return;
  saveReviewsTimer = setTimeout(() => {
    saveReviewsTimer = null;
    try {
      fs.writeFileSync(REVIEWS_FILE, JSON.stringify(state.reviews, null, 2), "utf8");
    } catch (e) {
      console.warn("[stats] failed to persist reviews:", e);
    }
  }, 2_000);
}

// ── In-memory state (warm-loaded from disk) ───────────────────────────────────
const persisted = loadStats();

const state = {
  totalAllTime:  persisted.totalAllTime,
  downloadsToday: persisted.downloadsToday,
  lastResetDate:  persisted.lastResetDate,
  platformCounts: new Map<string, number>(Object.entries(persisted.platformCounts)),
  trendingMap:    new Map<string, DownloadRecord>(Object.entries(persisted.trending)),
  reviews:        loadReviews(),

  // Runtime-only (not persisted)
  activeSessions: new Map<string, number>(),  // sessionId → lastSeen ms
  activeDownloads: new Set<string>(),          // set of fileIds
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetIfNewDay() {
  const today = new Date().toDateString();
  if (today !== state.lastResetDate) {
    state.downloadsToday = 0;
    state.lastResetDate = today;
    scheduleSaveStats();
  }
}

function pruneOldSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, lastSeen] of state.activeSessions) {
    if (lastSeen < cutoff) state.activeSessions.delete(id);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export const statsStore = {
  recordVisit(sessionId: string) {
    state.activeSessions.set(sessionId, Date.now());
    pruneOldSessions();
  },

  startDownload(fileId: string) {
    state.activeDownloads.add(fileId);
  },

  endDownload(fileId: string, record?: { title: string; platform: string }) {
    state.activeDownloads.delete(fileId);
    resetIfNewDay();

    state.downloadsToday++;
    state.totalAllTime++;

    const plat = record?.platform || "Other";
    state.platformCounts.set(plat, (state.platformCounts.get(plat) || 0) + 1);

    if (record?.title && record.title !== "Unknown") {
      const key = record.title.slice(0, 80);
      const existing = state.trendingMap.get(key);
      if (existing) {
        existing.count++;
        existing.lastDownloaded = Date.now();
      } else {
        state.trendingMap.set(key, {
          title: key, platform: plat, count: 1, lastDownloaded: Date.now(),
        });
      }
      // Keep top 100 trending
      if (state.trendingMap.size > 100) {
        const oldest = [...state.trendingMap.entries()]
          .sort((a, b) => a[1].lastDownloaded - b[1].lastDownloaded)[0];
        state.trendingMap.delete(oldest[0]);
      }
    }

    scheduleSaveStats();
  },

  getStats() {
    resetIfNewDay();
    pruneOldSessions();
    const load = state.activeDownloads.size;
    return {
      activeUsers:    Math.max(state.activeSessions.size, 1),
      downloading:    state.activeDownloads.size,
      totalToday:     state.downloadsToday,
      totalAllTime:   state.totalAllTime,
      serverStatus:   load < 5 ? "Fast" : load < 20 ? "Normal" : "Busy" as const,
      platformCounts: Object.fromEntries(state.platformCounts),
    };
  },

  getTrending() {
    return [...state.trendingMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  },

  getPlatformRanking() {
    return [...state.platformCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([platform, count]) => ({ platform, count }));
  },

  getRatings() {
    const sorted = [...state.reviews].sort((a, b) => b.timestamp - a.timestamp);
    const avg = state.reviews.length
      ? state.reviews.reduce((s, r) => s + r.stars, 0) / state.reviews.length
      : 0;
    const distribution = [5, 4, 3, 2, 1].map(s => ({
      stars: s,
      count: state.reviews.filter(r => r.stars === s).length,
    }));
    const platforms = [...new Set(state.reviews.map(r => r.platform))];
    const platformRatings = platforms.map(p => {
      const pReviews = state.reviews.filter(r => r.platform === p);
      return {
        platform: p,
        average: Math.round(pReviews.reduce((s, r) => s + r.stars, 0) / pReviews.length * 10) / 10,
        count: pReviews.length,
      };
    });
    return {
      average: Math.round(avg * 10) / 10,
      count: state.reviews.length,
      reviews: sorted.slice(0, 50),
      distribution,
      platformRatings,
    };
  },

  addReview(data: { stars: number; review: string; platform: string; author?: string }) {
    const newReview: Review = {
      id:        crypto.randomBytes(8).toString("hex"),
      stars:     Math.max(1, Math.min(5, data.stars)),
      review:    (data.review || "").slice(0, 500),
      platform:  data.platform || "Other",
      author:    (data.author || "Anonymous").slice(0, 30),
      timestamp: Date.now(),
      likes: 0,
      dislikes: 0,
    };
    state.reviews.unshift(newReview);
    // Keep max 500 reviews in memory
    if (state.reviews.length > 500) state.reviews = state.reviews.slice(0, 500);
    scheduleSaveReviews();
    return newReview;
  },

  reactToReview(id: string, type: "like" | "dislike") {
    const review = state.reviews.find(r => r.id === id);
    if (!review) return null;
    if (type === "like") review.likes++;
    else review.dislikes++;
    scheduleSaveReviews();
    return review;
  },

  get size() { return state.reviews.length; },
};
