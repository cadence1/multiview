import { create } from "zustand";
import { api } from "./api.js";
import { stableKey } from "./utils.js";
import type { Creator, CreatorStatus, ExportedCreator, ImportResult, Platform, Recording, VolumeStats } from "./types.js";

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
  /**
   * Creators that auto-open in the grid when they go live and auto-close
   * when they end. Keyed by stableKey (platform:platform_id), NOT
   * creator.id — that's just a database primary key that a fresh nanoid()
   * replaces on every import (and even a plain untrack/re-add), so keying
   * by it would silently orphan pins the moment that happens.
   */
  autoAddIds: string[];
  /** Master volume (0-100), scales every cell's own volume. */
  masterVolume: number;
  /** Per-creator saved volume (0-100, default 100 when unset), keyed by stableKey — see autoAddIds. */
  creatorVolumes: Record<string, number>;
  loading: boolean;
  error: string | null;
  /** In-progress + completed recordings — server-side, not per-browser, same as `creators`. */
  recordings: Recording[];
  /** Disk usage for the whole volume backing RECORDINGS_DIR, not just recordings' own footprint — null until first fetched. */
  storageStats: VolumeStats | null;

  refreshCreators: () => Promise<void>;
  refreshStatuses: () => Promise<void>;
  addCreator: (platform: Platform, query: string) => Promise<void>;
  removeCreator: (id: string) => Promise<void>;
  removeCreators: (ids: string[]) => Promise<void>;
  importCreators: (creators: ExportedCreator[]) => Promise<ImportResult>;
  toggleGrid: (id: string) => void;
  removeFromGrid: (id: string) => void;
  clearGrid: () => void;
  toggleAutoAdd: (creator: Creator) => void;
  setAutoAdd: (creator: Creator, pinned: boolean) => void;
  setMasterVolume: (v: number) => void;
  setCreatorVolume: (creator: Creator, v: number) => void;
  toggleAutoRecord: (creator: Creator) => Promise<void>;
  toggleRecordNext: (creator: Creator) => Promise<void>;
  refreshRecordings: () => Promise<void>;
  startRecording: (creatorId: string) => Promise<void>;
  stopRecording: (id: string) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  refreshStorageStats: () => Promise<void>;
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
  recordings: [],
  storageStats: null,

  refreshCreators: async () => {
    const creators = await api.listCreators();
    set({ creators });
  },

  refreshStatuses: async () => {
    const list = await api.listStatuses();
    const statuses: Record<string, CreatorStatus> = {};
    for (const s of list) statuses[s.creatorId] = s;

    set((state) => {
      // Pinned (autoAddIds, keyed by stableKey) creators: open automatically
      // when they go live, close automatically once they stop being live.
      // "Stop being live" is judged against the *previous* status snapshot,
      // not just "isn't live now" — otherwise an upcoming creator someone
      // pre-added by hand (never live yet) would get yanked out the moment
      // this runs. Iterates tracked creators (not autoAddIds directly) since
      // a pin only does anything once a matching creator is actually
      // tracked — the id needed to check statuses/gridIds lives on Creator.
      let gridIds = state.gridIds;
      let changed = false;
      const pinnedKeys = new Set(state.autoAddIds);
      for (const creator of state.creators) {
        if (!pinnedKeys.has(stableKey(creator))) continue;
        const id = creator.id;
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

  toggleAutoAdd: (creator) => {
    const pinned = get().autoAddIds.includes(stableKey(creator));
    get().setAutoAdd(creator, !pinned);
  },

  setAutoAdd: (creator, pinned) => {
    const key = stableKey(creator);
    set((state) => {
      const already = state.autoAddIds.includes(key);
      if (already === pinned) return state;
      const autoAddIds = pinned
        ? [...state.autoAddIds, key]
        : state.autoAddIds.filter((k) => k !== key);
      saveIds(AUTO_ADD_STORAGE_KEY, autoAddIds);

      // Pinning a creator that's already live opens it immediately, rather
      // than waiting for the next status poll.
      let gridIds = state.gridIds;
      if (pinned && state.statuses[creator.id]?.state === "live" && !gridIds.includes(creator.id)) {
        gridIds = [...gridIds, creator.id];
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

  setCreatorVolume: (creator, v) => {
    const clamped = clampVolume(v);
    const key = stableKey(creator);
    set((state) => {
      const creatorVolumes = { ...state.creatorVolumes, [key]: clamped };
      saveCreatorVolumes(creatorVolumes);
      return { creatorVolumes };
    });
  },

  toggleAutoRecord: async (creator) => {
    const next = !creator.auto_record;
    const updated = await api.setAutoRecord(creator.id, next);
    set((state) => ({
      creators: state.creators.map((c) => (c.id === creator.id ? updated : c)),
    }));
  },

  toggleRecordNext: async (creator) => {
    const next = !creator.record_next;
    const updated = await api.setRecordNext(creator.id, next);
    set((state) => ({
      creators: state.creators.map((c) => (c.id === creator.id ? updated : c)),
    }));
  },

  refreshRecordings: async () => {
    const recordings = await api.listRecordings();
    set({ recordings });
  },

  startRecording: async (creatorId) => {
    const recording = await api.startRecording(creatorId);
    set((state) => ({ recordings: [recording, ...state.recordings] }));
  },

  stopRecording: async (id) => {
    await api.stopRecording(id);
    // The server finalizes (remux, final size) asynchronously after the
    // process actually exits — refresh shortly after so the list picks up
    // the real completed state instead of staying on "recording".
    setTimeout(() => {
      get().refreshRecordings().catch(() => {});
    }, 3000);
  },

  deleteRecording: async (id) => {
    await api.deleteRecording(id);
    set((state) => ({ recordings: state.recordings.filter((r) => r.id !== id) }));
    // Freed space won't show up until the next storage refresh — deletion
    // is the one recording action where the disk numbers actually change,
    // so refresh proactively rather than waiting on the panel's own timer.
    get().refreshStorageStats().catch(() => {});
  },

  refreshStorageStats: async () => {
    const storageStats = await api.getRecordingStorage();
    set({ storageStats });
  },
}));
