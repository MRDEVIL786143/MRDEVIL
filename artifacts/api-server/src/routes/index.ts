import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videoRouter from "./video";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/video", videoRouter);
router.use("/stats", statsRouter);

export default router;
