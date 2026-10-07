import { Router, type IRouter, type Request, type Response } from "express";
import { statsStore } from "../stats-store.js";

const router: IRouter = Router();

// GET /api/stats — live stats
router.get("/", (req: Request, res: Response) => {
  const sessionId = (req.headers["x-session-id"] as string) || "anon";
  statsStore.recordVisit(sessionId);
  res.json(statsStore.getStats());
});

// GET /api/stats/trending
router.get("/trending", (_req: Request, res: Response) => {
  res.json({ trending: statsStore.getTrending() });
});

// GET /api/stats/platforms
router.get("/platforms", (_req: Request, res: Response) => {
  res.json({ platforms: statsStore.getPlatformRanking() });
});

// GET /api/stats/ratings
router.get("/ratings", (_req: Request, res: Response) => {
  res.json(statsStore.getRatings());
});

// POST /api/stats/ratings — submit a review
router.post("/ratings", (req: Request, res: Response) => {
  const { stars, review, platform, author } = req.body as {
    stars?: number;
    review?: string;
    platform?: string;
    author?: string;
  };

  if (!stars || stars < 1 || stars > 5) {
    res.status(400).json({ error: "stars must be 1–5" });
    return;
  }

  const newReview = statsStore.addReview({
    stars: Math.round(stars),
    review: review || "",
    platform: platform || "Other",
    author: author || "Anonymous",
  });

  res.json({ success: true, review: newReview });
});

// POST /api/stats/ratings/:id/react — like or dislike a review
router.post("/ratings/:id/react", (req: Request, res: Response) => {
  const { id } = req.params as Record<string, string>;
  const { type } = req.body as { type?: "like" | "dislike" };

  if (type !== "like" && type !== "dislike") {
    res.status(400).json({ error: "type must be like or dislike" });
    return;
  }

  const updated = statsStore.reactToReview(id, type);
  if (!updated) {
    res.status(404).json({ error: "Review not found" });
    return;
  }

  res.json({ success: true, review: updated });
});

export default router;
