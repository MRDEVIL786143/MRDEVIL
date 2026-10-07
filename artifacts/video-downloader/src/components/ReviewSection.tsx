import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, ThumbsUp, ThumbsDown, Flag, ChevronDown, ChevronUp } from "lucide-react";
import { useRatings } from "@/hooks/useStats";
import { cn } from "@/lib/utils";

const PLATFORMS = ["YouTube", "TikTok", "Instagram", "Facebook", "Twitter/X", "Reddit", "Vimeo", "Pinterest", "Other"];

function StarRating({ value, onChange, size = "md" }: { value: number; onChange?: (v: number) => void; size?: "sm" | "md" }) {
  const [hovered, setHovered] = useState(0);
  const sz = size === "sm" ? "w-4 h-4" : "w-7 h-7";
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(s => (
        <button
          key={s}
          type="button"
          onClick={() => onChange?.(s)}
          onMouseEnter={() => onChange && setHovered(s)}
          onMouseLeave={() => onChange && setHovered(0)}
          className={cn("transition-transform", onChange && "cursor-pointer hover:scale-110")}
          disabled={!onChange}
        >
          <Star
            className={cn(sz, "transition-colors", (hovered || value) >= s ? "fill-yellow-400 text-yellow-400" : "text-slate-600")}
          />
        </button>
      ))}
    </div>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ReviewSection() {
  const { data, submitReview, react } = useRatings();
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ stars: 0, review: "", platform: "YouTube", author: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reacted, setReacted] = useState<Set<string>>(new Set());

  if (!data) return null;

  const visibleReviews = showAll ? data.reviews : data.reviews.slice(0, 4);
  const maxDist = Math.max(...data.distribution.map(d => d.count), 1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.stars === 0) return;
    setSubmitting(true);
    const ok = await submitReview(form.stars, form.review, form.platform, form.author || "Anonymous");
    setSubmitting(false);
    if (ok) {
      setSubmitted(true);
      setShowForm(false);
      setForm({ stars: 0, review: "", platform: "YouTube", author: "" });
    }
  };

  const handleReact = async (id: string, type: "like" | "dislike") => {
    if (reacted.has(id)) return;
    setReacted(prev => new Set([...prev, id]));
    await react(id, type);
  };

  return (
    <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-20 border-t border-white/5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Star className="w-3.5 h-3.5 fill-yellow-400" />
            Community Ratings
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">⭐ Ratings & Reviews</h2>
          <p className="text-slate-400">What users are saying about MR DEVIL VIDEO DOWNLOADER</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 mb-10">
          {/* Overall score */}
          <div className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center text-center">
            <div className="text-7xl font-black text-white mb-2 tabular-nums">{data.average}</div>
            <StarRating value={Math.round(data.average)} size="md" />
            <p className="text-slate-400 text-sm mt-3">{data.count} reviews</p>

            <div className="w-full mt-6 space-y-2">
              {data.distribution.map(d => (
                <div key={d.stars} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 w-4 text-right">{d.stars}</span>
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-yellow-400/70"
                      style={{ width: `${(d.count / maxDist) * 100}%` }}
                    />
                  </div>
                  <span className="text-slate-500 w-4">{d.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Platform ratings */}
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5">Platform Ratings</h3>
            <div className="space-y-4">
              {data.platformRatings.map(pr => (
                <div key={pr.platform} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-300 flex-1">{pr.platform}</span>
                  <StarRating value={Math.round(pr.average)} size="sm" />
                  <span className="text-xs text-slate-500 tabular-nums w-6">{pr.average}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Write a review */}
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Share Your Experience</h3>
            {submitted && (
              <div className="mb-4 bg-green-500/10 border border-green-500/20 text-green-400 text-sm px-4 py-3 rounded-xl">
                ✓ Thank you for your review!
              </div>
            )}
            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="w-full bg-gradient-to-br from-yellow-500/20 to-amber-500/20 hover:from-yellow-500/30 hover:to-amber-500/30 border border-yellow-500/30 text-yellow-300 font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <Star className="w-4 h-4 fill-yellow-400" />
                Write a Review
              </button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 mb-2 block">Your rating *</label>
                  <StarRating value={form.stars} onChange={s => setForm(f => ({ ...f, stars: s }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Platform</label>
                  <select
                    value={form.platform}
                    onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Name (optional)</label>
                  <input
                    value={form.author}
                    onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                    placeholder="Anonymous"
                    maxLength={30}
                    className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Review (optional)</label>
                  <textarea
                    value={form.review}
                    onChange={e => setForm(f => ({ ...f, review: e.target.value }))}
                    placeholder="Tell us about your experience…"
                    maxLength={300}
                    rows={3}
                    className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder:text-slate-600 resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={form.stars === 0 || submitting}
                    className="flex-1 bg-gradient-primary text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2.5 text-slate-400 text-sm hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Reviews list */}
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {visibleReviews.map((review, idx) => (
              <motion.div
                key={review.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="glass-panel rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {review.author.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{review.author}</p>
                      <p className="text-xs text-slate-500">{formatDate(review.timestamp)} · {review.platform}</p>
                    </div>
                  </div>
                  <StarRating value={review.stars} size="sm" />
                </div>
                {review.review && (
                  <p className="text-slate-300 text-sm pl-12 leading-relaxed mb-3">{review.review}</p>
                )}
                <div className="flex items-center gap-3 pl-12">
                  <button
                    onClick={() => handleReact(review.id, "like")}
                    disabled={reacted.has(review.id)}
                    className={cn(
                      "flex items-center gap-1.5 text-xs transition-colors",
                      reacted.has(review.id) ? "text-slate-600 cursor-not-allowed" : "text-slate-500 hover:text-green-400"
                    )}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>{review.likes}</span>
                  </button>
                  <button
                    onClick={() => handleReact(review.id, "dislike")}
                    disabled={reacted.has(review.id)}
                    className={cn(
                      "flex items-center gap-1.5 text-xs transition-colors",
                      reacted.has(review.id) ? "text-slate-600 cursor-not-allowed" : "text-slate-500 hover:text-red-400"
                    )}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>{review.dislikes}</span>
                  </button>
                  <button className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition-colors ml-auto">
                    <Flag className="w-3 h-3" />
                    Report
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {data.reviews.length > 4 && (
          <div className="text-center mt-6">
            <button
              onClick={() => setShowAll(v => !v)}
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors glass-panel px-6 py-3 rounded-xl"
            >
              {showAll ? <><ChevronUp className="w-4 h-4" /> Show less</> : <><ChevronDown className="w-4 h-4" /> Show all {data.reviews.length} reviews</>}
            </button>
          </div>
        )}
      </motion.div>
    </section>
  );
}
