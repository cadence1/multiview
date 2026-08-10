import type { Creator, CreatorStatus, ExportedCreator, ImportResult, Platform } from "./types.js";

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
};
