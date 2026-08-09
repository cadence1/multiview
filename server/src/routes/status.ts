import { Router } from "express";
import { statusCache } from "../cache.js";

export const statusRouter = Router();

statusRouter.get("/", (_req, res) => {
  res.json(statusCache.all());
});
