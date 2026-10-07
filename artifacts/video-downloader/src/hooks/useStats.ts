import { useEffect, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE}/api/stats`;

export interface Stats {
  activeUsers: number;
  downloading: number;
  totalToday: number;
  totalAllTime: number;
  serverStatus: "Fast" | "Normal" | "Busy";
  platformCounts: Record<string, number>;
}

export interface TrendingItem {
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

export interface RatingsData {
  average: number;
  count: number;
  reviews: Review[];
  distribution: { stars: number; count: number }[];
  platformRatings: { platform: string; average: number; count: number }[];
}

export function useLiveStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(API, {
        headers: { "x-session-id": getSessionId() },
      });
      if (r.ok) setStats(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  return stats;
}

export function useTrending() {
  const [trending, setTrending] = useState<TrendingItem[]>([]);

  useEffect(() => {
    fetch(`${API}/trending`)
      .then(r => r.json())
      .then(d => setTrending(d.trending || []))
      .catch(() => {});
  }, []);

  return trending;
}

export function useRatings() {
  const [data, setData] = useState<RatingsData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/ratings`);
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submitReview = async (stars: number, review: string, platform: string, author: string) => {
    const r = await fetch(`${API}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars, review, platform, author }),
    });
    if (r.ok) await refresh();
    return r.ok;
  };

  const react = async (id: string, type: "like" | "dislike") => {
    const r = await fetch(`${API}/ratings/${id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (r.ok) await refresh();
  };

  return { data, loading, refresh, submitReview, react };
}

function getSessionId(): string {
  let id = sessionStorage.getItem("fvd-session");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("fvd-session", id);
  }
  return id;
}
