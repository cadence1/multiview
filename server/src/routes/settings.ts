import { Router } from "express";
import { statements } from "../db.js";
import * as smb from "../recordings/smb.js";

export const settingsRouter = Router();

/** Never echoes the real password back — a GET is read by the browser, and
 * the settings dialog only needs to know whether one's already saved (to
 * show a "leave blank to keep" placeholder) not what it actually is. */
function toPublicShape(row: ReturnType<typeof statements.smbSettings.get>) {
  return {
    enabled: Boolean(row.enabled),
    host: row.host,
    port: row.port,
    share: row.share,
    domain: row.domain,
    username: row.username,
    hasPassword: Boolean(row.password),
    basePath: row.base_path,
  };
}

settingsRouter.get("/smb", (_req, res) => {
  res.json(toPublicShape(statements.smbSettings.get()));
});

settingsRouter.put("/smb", async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.host !== "string" || typeof body.share !== "string") {
    return res.status(400).json({ error: "host and share are required" });
  }
  const current = statements.smbSettings.get();
  statements.smbSettings.set({
    enabled: body.enabled ? 1 : 0,
    host: body.host.trim(),
    port: Number(body.port) || 445,
    share: body.share.trim(),
    domain: typeof body.domain === "string" ? body.domain.trim() : "",
    username: typeof body.username === "string" ? body.username.trim() : "",
    // Blank/omitted password means "keep what's already saved" — a saved
    // secret is never round-tripped back to the client (see
    // toPublicShape), so there's nothing for the form to legitimately
    // resubmit unless the user is actually changing it.
    password: typeof body.password === "string" && body.password !== "" ? body.password : current.password,
    base_path: typeof body.basePath === "string" ? body.basePath.trim() : "",
  });

  // Settings are saved regardless of what happens below — a failed mount
  // attempt shouldn't lose what the user just typed, it just means the
  // toggle doesn't take effect yet (surfaced via mountError, not a 4xx/5xx,
  // so the form doesn't look like saving itself failed).
  //
  // Always unmount before (re-)mounting, not just when going from
  // disabled->enabled — mount() is a no-op against an already-mounted
  // directory (see smb.ts's isMountedAt short-circuit), so saving *changed*
  // settings (a different host/share/credentials) while already mounted
  // would otherwise silently keep serving the stale, previous config
  // instead of picking up what was just saved.
  let mountError: string | undefined;
  await smb.unmount();
  if (body.enabled) {
    const result = await smb.mount();
    if (!result.ok) mountError = result.error;
  }

  res.json({ ...toPublicShape(statements.smbSettings.get()), mountError });
});

/**
 * Tests a candidate configuration live — actually writes, reads back, and
 * deletes a small marker file at base_path, so success means real write
 * access, not just that the server responded to a login. Accepts the same
 * "blank password keeps the saved one" convention as PUT, so the user can
 * test without re-entering it every time once it's already saved.
 */
settingsRouter.post("/smb/test", async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.host !== "string" || typeof body.share !== "string") {
    return res.status(400).json({ error: "host and share are required" });
  }
  const current = statements.smbSettings.get();
  const result = await smb.testConnection({
    host: body.host.trim(),
    port: Number(body.port) || 445,
    share: body.share.trim(),
    domain: typeof body.domain === "string" ? body.domain.trim() : "",
    username: typeof body.username === "string" ? body.username.trim() : "",
    password: typeof body.password === "string" && body.password !== "" ? body.password : current.password,
    base_path: typeof body.basePath === "string" ? body.basePath.trim() : "",
  });
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json({ ok: true });
});
