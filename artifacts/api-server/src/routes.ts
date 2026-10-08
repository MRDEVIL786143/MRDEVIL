import { Router, type Request, type Response } from "express";
import { statsStore } from "./stats-store";

const router = Router();

// ── Status endpoints ──────────────────────────────────────────────────────────
router.get("/video/status", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Live stats — frontend expects activeUsers, downloading, totalToday, etc.
router.get("/stats", (req: Request, res: Response) => {
  const sessionId = req.headers["x-session-id"] as string | undefined;
  if (sessionId) statsStore.recordVisit(sessionId);
  res.json(statsStore.getStats());
});

// Trending — frontend does: setTrending(d.trending || [])
router.get("/stats/trending", (_req: Request, res: Response) => {
  res.json({ trending: statsStore.getTrending() });
});

router.get("/stats/platforms", (_req: Request, res: Response) => {
  res.json(Object.fromEntries(
    statsStore.getPlatformRanking().map(p => [p.platform, p.count])
  ));
});

// Ratings — MUST return object, NOT []  (empty array was crashing ReviewSection)
router.get("/stats/ratings", (_req: Request, res: Response) => {
  res.json(statsStore.getRatings());
});

// ── Video operations ──────────────────────────────────────────────────────────
router.post("/video/info", async (req: Request, res: Response) => {
  try {
    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/video/download", async (req: Request, res: Response) => {
  try {
    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/video/instagram-status", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    configured: false,
  });
});

router.post("/video/instagram-cookies", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented" });
});

// ── Reviews ───────────────────────────────────────────────────────────────────
router.post("/stats/ratings", (req: Request, res: Response) => {
  try {
    const { stars, review, platform, author } = req.body || {};
    if (!stars || stars < 1 || stars > 5) {
      res.status(400).json({ error: "stars must be 1-5" });
      return;
    }
    const newReview = statsStore.addReview({ stars, review, platform, author });
    res.json(newReview);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/stats/ratings/:id/react", (req: Request, res: Response) => {
  try {
    const { type } = req.body || {};
    if (type !== "like" && type !== "dislike") {
      res.status(400).json({ error: "type must be like or dislike" });
      return;
    }
    const updated = statsStore.reactToReview(req.params.id, type);
    if (!updated) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
