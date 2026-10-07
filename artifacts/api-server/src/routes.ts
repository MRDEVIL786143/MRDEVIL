import { Router, type Request, type Response } from "express";

const router = Router();

// ── Status endpoints ──────────────────────────────────────────────────────────
router.get("/video/status", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

router.get("/stats", (_req: Request, res: Response) => {
  res.json({
    downloads: 0,
    platforms: {},
    trending: [],
  });
});

router.get("/stats/trending", (_req: Request, res: Response) => {
  res.json([]);
});

router.get("/stats/platforms", (_req: Request, res: Response) => {
  res.json({});
});

router.get("/stats/ratings", (_req: Request, res: Response) => {
  res.json([]);
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

router.post("/video/instagram-cookies", (req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented" });
});

// ── Reviews ───────────────────────────────────────────────────────────────────
router.post("/stats/ratings", (req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented" });
});

router.post("/stats/ratings/:id/react", (req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented" });
});

export default router;
