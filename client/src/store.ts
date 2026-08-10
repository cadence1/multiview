import { create } from "zustand";
import { api } from "./api.js";
import type { Creator, CreatorStatus, ExportedCreator, ImportResult, Platform } from "./types.js";

const GRID_STORAGE_KEY = "multiview.gridIds";
const AUTO_ADD_STORAGE_KEY = "multiview.autoAddIds";
const MASTER_VOLUME_KEY = "multiview.masterVolume";
const CREATOR_VOLUME_KEY = "multiview.creatorVolumes";

function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // storage unavailable, ignore
  }
}

function clampVolume(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

function loadMasterVolume(): number {
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_KEY);
    const n = raw ? Number(raw) : 100;
    return Number.isFinite(n) ? clampVolume(n) : 100;
  } catch {
    return 100;
  }
}

function loadCreatorVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CREATOR_VOLUME_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCreatorVolumes(map: Record<string, number>) {
  try {
    localStorage.setItem(CREATOR_VOLUME_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable, ignore
  }
}

interface MultiviewState {
  creators: Creator[];
  statuses: Record<string, CreatorStatus>;
  gridIds: string[];
  /** Creators that auto-open in the grid when they go live and auto-close when they end. */
  autoAddIds: string[];
  /** Master volume (0-100), scales every cell's own volume. */
  masterVolume: number;
  /** Per-creator saved volume (0-100, default 100 when unset) — persists across sessions. */
  creatorVolumes: Record<string, number>;
  loading: boolean;
  error: string | null;

  refreshCreators: () => Promise<void>;
  refreshStatuses: () => Promise<void>;
  addCreator: (platform: Platform, query: string) => Promise<void>;
  removeCreator: (id: string) => Promise<void>;
  removeCreators: (ids: string[]) => Promise<void>;
  importCreators: (creators: ExportedCreator[]) => Promise<ImportResult>;
  toggleGrid: (id: string) => void;
  removeFromGrid: (id: string) => void;
  clearGrid: () => void;
  toggleAutoAdd: (id: string) => void;
  setMasterVolume: (v: number) => void;
  setCreatorVolume: (id: string, v: number) => void;
}

export const useStore = create<MultiviewState>((set, get) => ({
  creators: [],
  statuses: {},
  gridIds: loadIds(GRID_STORAGE_KEY),
  autoAddIds: loadIds(AUTO_ADD_STORAGE_KEY),
  masterVolume: loadMasterVolume(),
  creatorVolumes: loadCreatorVolumes(),
  loading: false,
  error: null,

  refreshCreators: async () => {
    const creators = await api.listCreators();
    set({ creators });
  },

  refreshStatuses: async () => {
    const list = await api.listStatuses();
    const statuses: Record<string, CreatorStatus> = {};
    for (const s of list) statuses[s.creatorId] = s;

    set((state) => {
      // Pinned (autoAddIds) creators: open automatically when they go live,
      // close automatically once they stop being live. "Stop being live"
      // is judged against the *previous* status snapshot, not just "isn't
      // live now" — otherwise an upcoming creator someone pre-added by hand
      // (never live yet) would get yanked out the moment this runs.
      let gridIds = state.gridIds;
      let changed = false;
      for (const id of state.autoAddIds) {
        const wasLive = state.statuses[id]?.state === "live";
        const isLive = statuses[id]?.state === "live";
        const inGrid = gridIds.includes(id);
        if (isLive && !inGrid) {
          gridIds = [...gridIds, id];
          changed = true;
        } else if (!isLive && wasLive && inGrid) {
          gridIds = gridIds.filter((g) => g !== id);
          changed = true;
        }
      }
      if (changed) saveIds(GRID_STORAGE_KEY, gridIds);
      return { statuses, gridIds };
    });
  },

  addCreator: async (platform, query) => {
    set({ loading: true, error: null });
    try {
      const creator = await api.addCreator(platform, query);
      set((state) => ({ creators: [...state.creators, creator] }));
      // Give the server a moment to run its immediate status check.
      setTimeout(() => {
        get().refreshStatuses().catch(() => {});
      }, 1500);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  removeCreator: async (id) => {
    await api.removeCreator(id);
    set((state) => ({
      creators: state.creators.filter((c) => c.id !== id),
      gridIds: state.gridIds.filter((g) => g !== id),
      autoAddIds: state.autoAddIds.filter((g) => g !== id),
    }));
    saveIds(GRID_STORAGE_KEY, get().gridIds);
    saveIds(AUTO_ADD_STORAGE_KEY, get().autoAddIds);
  },

  removeCreators: async (ids) => {
    // No bulk endpoint server-side — just fire the per-id deletes in
    // parallel and settle the store once, rather than N separate renders.
    await Promise.all(ids.map((id) => api.removeCreator(id)));
    const idSet = new Set(ids);
    set((state) => ({
      creators: state.creators.filter((c) => !idSet.has(c.id)),
      gridIds: state.gridIds.filter((g) => !idSet.has(g)),
      autoAddIds: state.autoAddIds.filter((g) => !idSet.has(g)),
    }));
    saveIds(GRID_STORAGE_KEY, get().gridIds);
    saveIds(AUTO_ADD_STORAGE_KEY, get().autoAddIds);
  },

  importCreators: async (creators) => {
    set({ loading: true, error: null });
    try {
      const result = await api.importCreators(creators);
      await get().refreshCreators();
      // Give the server a moment to run its immediate status checks.
      setTimeout(() => {
        get().refreshStatuses().catch(() => {});
      }, 1500);
      return result;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  toggleGrid: (id) => {
    set((state) => {
      const inGrid = state.gridIds.includes(id);
      const gridIds = inGrid
        ? state.gridIds.filter((g) => g !== id)
        : [...state.gridIds, id];
      saveIds(GRID_STORAGE_KEY, gridIds);
      return { gridIds };
    });
  },

  removeFromGrid: (id) => {
    set((state) => {
      const gridIds = state.gridIds.filter((g) => g !== id);
      saveIds(GRID_STORAGE_KEY, gridIds);
      return { gridIds };
    });
  },

  clearGrid: () => {
    saveIds(GRID_STORAGE_KEY, []);
    set({ gridIds: [] });
  },

  toggleAutoAdd: (id) => {
    set((state) => {
      const pinned = state.autoAddIds.includes(id);
      const autoAddIds = pinned
        ? state.autoAddIds.filter((g) => g !== id)
        : [...state.autoAddIds, id];
      saveIds(AUTO_ADD_STORAGE_KEY, autoAddIds);

      // Pinning a creator that's already live opens it immediately, rather
      // than waiting for the next status poll.
      let gridIds = state.gridIds;
      if (!pinned && state.statuses[id]?.state === "live" && !gridIds.includes(id)) {
        gridIds = [...gridIds, id];
        saveIds(GRID_STORAGE_KEY, gridIds);
      }

      return { autoAddIds, gridIds };
    });
  },

  setMasterVolume: (v) => {
    const clamped = clampVolume(v);
    try {
      localStorage.setItem(MASTER_VOLUME_KEY, String(clamped));
    } catch {
      // storage unavailable, ignore
    }
    set({ masterVolume: clamped });
  },

  setCreatorVolume: (id, v) => {
    const clamped = clampVolume(v);
    set((state) => {
      const creatorVolumes = { ...state.creatorVolumes, [id]: clamped };
      saveCreatorVolumes(creatorVolumes);
      return { creatorVolumes };
    });
  },
}));
