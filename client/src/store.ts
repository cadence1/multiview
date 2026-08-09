import { create } from "zustand";
import { api } from "./api.js";
import type { Creator, CreatorStatus, Platform } from "./types.js";

const GRID_STORAGE_KEY = "multiview.gridIds";

function loadGridIds(): string[] {
  try {
    const raw = localStorage.getItem(GRID_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGridIds(ids: string[]) {
  try {
    localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable, ignore
  }
}

interface MultiviewState {
  creators: Creator[];
  statuses: Record<string, CreatorStatus>;
  gridIds: string[];
  loading: boolean;
  error: string | null;

  refreshCreators: () => Promise<void>;
  refreshStatuses: () => Promise<void>;
  addCreator: (platform: Platform, query: string) => Promise<void>;
  removeCreator: (id: string) => Promise<void>;
  toggleGrid: (id: string) => void;
  removeFromGrid: (id: string) => void;
  clearGrid: () => void;
}

export const useStore = create<MultiviewState>((set, get) => ({
  creators: [],
  statuses: {},
  gridIds: loadGridIds(),
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
    set({ statuses });
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
    }));
    saveGridIds(get().gridIds);
  },

  toggleGrid: (id) => {
    set((state) => {
      const inGrid = state.gridIds.includes(id);
      const gridIds = inGrid
        ? state.gridIds.filter((g) => g !== id)
        : [...state.gridIds, id];
      saveGridIds(gridIds);
      return { gridIds };
    });
  },

  removeFromGrid: (id) => {
    set((state) => {
      const gridIds = state.gridIds.filter((g) => g !== id);
      saveGridIds(gridIds);
      return { gridIds };
    });
  },

  clearGrid: () => {
    saveGridIds([]);
    set({ gridIds: [] });
  },
}));
