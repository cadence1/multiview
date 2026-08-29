import type {
  Creator,
  CreatorStatus,
  ExportedCreator,
  ImportResult,
  Platform,
  Recording,
  SmbSettings,
  SmbSettingsInput,
  VolumeStats,
} from "./types.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listCreators: () => request<Creator[]>("/creators"),
  addCreator: (platform: Platform, query: string) =>
    request<Creator>("/creators", {
      method: "POST",
      body: JSON.stringify({ platform, query }),
    }),
  removeCreator: (id: string) =>
    request<void>(`/creators/${id}`, { method: "DELETE" }),
  importCreators: (creators: ExportedCreator[]) =>
    request<ImportResult>("/creators/import", {
      method: "POST",
      body: JSON.stringify({ creators }),
    }),
  listStatuses: () => request<CreatorStatus[]>("/status"),
  setAutoRecord: (id: string, autoRecord: boolean) =>
    request<Creator>(`/creators/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ autoRecord }),
    }),
  setRecordNext: (id: string, recordNext: boolean) =>
    request<Creator>(`/creators/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ recordNext }),
    }),
  listRecordings: () => request<Recording[]>("/recordings"),
  startRecording: (creatorId: string, fromStart?: boolean) =>
    request<Recording>("/recordings", {
      method: "POST",
      body: JSON.stringify({ creatorId, fromStart }),
    }),
  stopRecording: (id: string) => request<void>(`/recordings/${id}/stop`, { method: "POST" }),
  downloadVideo: (url: string) =>
    request<Recording>("/recordings/download", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  deleteRecording: (id: string) => request<void>(`/recordings/${id}`, { method: "DELETE" }),
  getRecordingStorage: () => request<VolumeStats>("/recordings/storage"),
  addRecordingTag: (id: string, name: string) =>
    request<void>(`/recordings/${id}/tags`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  removeRecordingTag: (id: string, name: string) =>
    request<void>(`/recordings/${id}/tags/${encodeURIComponent(name)}`, { method: "DELETE" }),
  getSmbSettings: () => request<SmbSettings>("/settings/smb"),
  updateSmbSettings: (settings: SmbSettingsInput) =>
    request<SmbSettings>("/settings/smb", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  testSmbConnection: (settings: SmbSettingsInput) =>
    request<{ ok: true }>("/settings/smb/test", {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  /** XHR, not fetch — fetch has no upload-progress event at all, and a
   * video file from another device can be large enough (many GB) that a
   * bare "uploading…" with no indication of progress would be a real
   * regression from every other action in this app giving some sense of
   * what's happening. XHR's upload.onprogress is the only way to get real
   * byte-level progress in a browser. */
  uploadRecording: (file: File, opts: { title?: string; displayName?: string }, onProgress?: (pct: number) => void) =>
    new Promise<Recording>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      if (opts.title) form.append("title", opts.title);
      if (opts.displayName) form.append("displayName", opts.displayName);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/recordings/upload");
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body: unknown;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as Recording);
        } else {
          const message = (body as { error?: string } | undefined)?.error || xhr.statusText || "upload failed";
          reject(new Error(message));
        }
      };
      xhr.onerror = () => reject(new Error("network error during upload"));
      xhr.send(form);
    }),
};
