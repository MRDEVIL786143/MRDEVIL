import { useLiveStats } from "@/hooks/useStats";
import { Users, Download, BarChart3, Activity } from "lucide-react";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

const STATUS_COLORS: Record<string, string> = {
  Fast: "text-green-400",
  Normal: "text-yellow-400",
  Busy: "text-orange-400",
};

export function LiveStats() {
  const stats = useLiveStats();

  const statusColor = STATUS_COLORS[stats?.serverStatus ?? "Fast"] ?? "text-green-400";

  return (
    <div className="w-full max-w-4xl mx-auto mb-8">
      <div className="glass-panel rounded-2xl px-4 py-3 flex flex-wrap items-center justify-center gap-4 sm:gap-8 border border-white/5">
        {/* Server status */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-xs font-semibold text-slate-300">
            Server: <span className={statusColor}>{stats?.serverStatus ?? "Online"}</span>
          </span>
        </div>

        <div className="hidden sm:block w-px h-4 bg-white/10" />

        {/* Active users */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <Users className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            <span className="font-bold text-white tabular-nums">{fmt(stats?.activeUsers ?? 0)}</span>
            {" "}active users
          </span>
        </div>

        <div className="hidden sm:block w-px h-4 bg-white/10" />

        {/* Currently downloading */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          <span>
            <span className="font-bold text-white tabular-nums">{stats?.downloading ?? 0}</span>
            {" "}downloading now
          </span>
        </div>

        <div className="hidden sm:block w-px h-4 bg-white/10" />

        {/* Today's downloads */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <Download className="w-3.5 h-3.5 text-pink-400" />
          <span>
            <span className="font-bold text-white tabular-nums">{fmt(stats?.totalToday ?? 0)}</span>
            {" "}downloads today
          </span>
        </div>

        <div className="hidden sm:block w-px h-4 bg-white/10" />

        {/* Daily visitors */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            <span className="font-bold text-white tabular-nums">{fmt(stats?.dailyVisitors ?? 0)}</span>
            {" "}visitors today
          </span>
        </div>
      </div>
    </div>
  );
}
