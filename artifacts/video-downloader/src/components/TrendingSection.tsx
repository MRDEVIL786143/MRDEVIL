import { motion } from "framer-motion";
import { TrendingUp, Flame, Trophy } from "lucide-react";
import { useTrending, useLiveStats } from "@/hooks/useStats";

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: "bg-red-500/20 text-red-300 border-red-500/30",
  TikTok: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  Instagram: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  Facebook: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Twitter/X": "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Reddit: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Vimeo: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  Pinterest: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  Other: "bg-slate-600/20 text-slate-400 border-slate-600/30",
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TrendingSection() {
  const trending = useTrending();
  const stats = useLiveStats();

  const platformRanking = stats?.platformCounts
    ? Object.entries(stats.platformCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  if (trending.length === 0 && platformRanking.length === 0) return null;

  return (
    <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-20 border-t border-white/5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Flame className="w-3.5 h-3.5" />
            Live Trending
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">🔥 Trending Downloads</h2>
          <p className="text-slate-400">Most downloaded content right now</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Trending list */}
          <div className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-400" />
              Top Downloads Today
            </h3>
            <div className="space-y-2">
              {trending.map((item, idx) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass-panel rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
                >
                  <span className={`text-sm font-black w-6 text-center shrink-0 ${
                    idx === 0 ? "text-yellow-400" :
                    idx === 1 ? "text-slate-300" :
                    idx === 2 ? "text-orange-400" : "text-slate-600"
                  }`}>
                    {idx < 3 ? ["🥇", "🥈", "🥉"][idx] : `#${idx + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.title}</p>
                    <p className="text-xs text-slate-500">{timeAgo(item.lastDownloaded)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${PLATFORM_COLORS[item.platform] || PLATFORM_COLORS.Other}`}>
                      {item.platform}
                    </span>
                    <span className="text-xs font-bold text-slate-400 tabular-nums">{item.count}×</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Platform ranking */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" />
              Most Used Platforms
            </h3>
            <div className="space-y-3">
              {platformRanking.map(([platform, count], idx) => {
                const total = platformRanking.reduce((s, [, c]) => s + c, 0);
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={platform}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-300 flex items-center gap-1.5">
                        <span>{idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : ""}</span>
                        {platform}
                      </span>
                      <span className="text-slate-400 tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: idx * 0.1 }}
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
