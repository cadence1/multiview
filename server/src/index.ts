import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import "./db.js";
import { creatorsRouter } from "./routes/creators.js";
import { statusRouter } from "./routes/status.js";
import { youtubePushRouter } from "./routes/youtubePush.js";
import { startPoller } from "./poller.js";
import { startPushRenewal } from "./youtubePush.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/creators", creatorsRouter);
app.use("/api/status", statusRouter);
// The POST side reads the raw request body itself (see routes/youtubePush.ts)
// rather than the express.json() above — that's harmless here since
// express.json() only consumes the body when Content-Type is
// application/json, and Google's hub sends application/atom+xml.
app.use("/api/youtube-push", youtubePushRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, pollIntervalSeconds: env.pollIntervalSeconds });
});

// Serve the built client, if present (production / Docker builds).
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

startPoller();
startPushRenewal();

app.listen(env.port, () => {
  console.log(`Multiview server listening on http://localhost:${env.port}`);
});
