import app from "./app.js";
import { spawn } from "child_process";
import { YT_DLP_PATH } from "./ytdlp.js";
import { proxyPool } from "./proxy-pool.js";

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`[boot] proxy pool: ${proxyPool.hasProxies ? `${proxyPool.count} proxy(ies) — rotation active` : "no proxies configured (direct server IP)"}`);
  const child = spawn(YT_DLP_PATH, ["--version"], { stdio: "ignore" });
  child.on("close", (code) => { if (code === 0) console.log("[warmup] yt-dlp ready"); });
  child.on("error", (e) => console.warn(`[warmup] yt-dlp not available at ${YT_DLP_PATH}: ${e.message}`));
});
