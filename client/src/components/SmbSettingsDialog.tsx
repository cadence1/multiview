import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { SmbSettingsInput } from "../types.js";
import ToggleSwitch from "./ToggleSwitch.js";

const EMPTY: SmbSettingsInput = {
  enabled: false,
  host: "",
  port: 445,
  share: "",
  domain: "",
  username: "",
  password: "",
  basePath: "",
};

/**
 * Configures the optional SMB offload backend for finished recordings —
 * same role as the S3_* env vars, just editable live instead of requiring
 * a redeploy. Loads the currently saved settings on open; the password
 * field is deliberately never pre-filled (the server never sends the real
 * value back — see routes/settings.ts) so it shows a "leave blank to keep"
 * placeholder instead, and submitting blank keeps whatever's already saved.
 */
export default function SmbSettingsDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<SmbSettingsInput>(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"ok" | null>(null);

  useEffect(() => {
    api
      .getSmbSettings()
      .then((s) => {
        setForm({
          enabled: s.enabled,
          host: s.host,
          port: s.port,
          share: s.share,
          domain: s.domain,
          username: s.username,
          password: "",
          basePath: s.basePath,
        });
        setHasPassword(s.hasPassword);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof SmbSettingsInput>(key: K, value: SmbSettingsInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      await api.testSmbConnection(form);
      setTestResult("ok");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateSmbSettings(form);
      // Settings are saved either way (see routes/settings.ts) — a
      // mountError means the toggle didn't actually take effect, which is
      // worth keeping the dialog open over rather than closing on a save
      // that silently didn't do what it looked like it did.
      if (saved.mountError) {
        setError(`Saved, but couldn't mount: ${saved.mountError}`);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = !form.enabled || (form.host.trim() && form.share.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-base-700 bg-base-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-100">SMB storage</h2>

        {loading ? (
          <p className="py-4 text-center text-xs text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2.5">
            <button
              type="button"
              onClick={() => update("enabled", !form.enabled)}
              className="flex w-full items-center justify-between rounded-md border border-base-600 px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
            >
              <span>Offload finished recordings to this share</span>
              <ToggleSwitch on={form.enabled} activeColorClassName="bg-indigo-600" />
            </button>

            <div className="grid grid-cols-3 gap-2">
              <input
                value={form.host}
                onChange={(e) => update("host", e.target.value)}
                placeholder="Host (e.g. nas.dfitz.io)"
                className="col-span-2 rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="number"
                value={form.port}
                onChange={(e) => update("port", Number(e.target.value) || 445)}
                placeholder="Port"
                className="rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <input
              value={form.share}
              onChange={(e) => update("share", e.target.value)}
              placeholder="Share name (e.g. nas)"
              className="w-full rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />

            <input
              value={form.basePath}
              onChange={(e) => update("basePath", e.target.value)}
              placeholder="Folder within the share (optional, e.g. multiview)"
              className="w-full rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.domain}
                onChange={(e) => update("domain", e.target.value)}
                placeholder="Domain (optional)"
                className="rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <input
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
                placeholder="Username"
                className="rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <input
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder={hasPassword ? "Password (leave blank to keep saved)" : "Password"}
              className="w-full rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />

            {error && <p className="text-xs text-red-400">{error}</p>}
            {testResult === "ok" && <p className="text-xs text-green-400">Connection works — wrote and read back a test file.</p>}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !form.host.trim() || !form.share.trim()}
                className="rounded-md border border-base-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-base-800 disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-base-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !canSubmit}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
