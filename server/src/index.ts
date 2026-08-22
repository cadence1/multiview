import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import "./db.js";
import { creatorsRouter } from "./routes/creators.js";
import { statusRouter } from "./routes/status.js";
import { recordingsRouter } from "./routes/recordings.js";
import { startPoller } from "./poller.js";
import { checkWritable } from "./recordings/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/creators", creatorsRouter);
app.use("/api/status", statusRouter);
app.use("/api/recordings", recordingsRouter);

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

checkWritable().then((result) => {
  if (!result.ok) {
    console.error(
      `[recordings] RECORDINGS_DIR (${env.recordingsDir}) isn't writable: ${result.error} — recording will fail until this is fixed.`
    );
  }
});

app.listen(env.port, () => {
  console.log(`Multiview server listening on http://localhost:${env.port}`);
});
