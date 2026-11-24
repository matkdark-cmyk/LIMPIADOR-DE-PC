import { create } from 'zustand';
import type {
  AppFilterKey,
  AppMetadataUpdate,
  AppSortKey,
  InstalledApp,
} from '../types';
import { fetchInstalledApps, isTauriRuntime } from '../utils/tauri';
import { useAppStore } from './useAppStore';

function extractError(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al consultar las aplicaciones instaladas.';
}

/**
 * Devuelve el tamaño más preciso disponible para una aplicación (peso real si ya fue calculado, o estimado).
 */
export function getEffectiveAppSize(app: InstalledApp): number {
  return app.realSizeBytes ?? app.estimatedSizeBytes;
}

interface AppsStoreState {
  apps: InstalledApp[];
  hasLoadedOnce: boolean;
  isLoadingApps: boolean;
  isEnrichingMetadata: boolean;
  enrichedCount: number;
  totalToEnrich: number;
  includeUwp: boolean;
  searchQuery: string;
  activeFilter: AppFilterKey;
  sortMode: AppSortKey;
  loadError: string | null;
  uninstallModalApp: InstalledApp | null;
  relocateModalApp: InstalledApp | null;

  loadApps: (force?: boolean) => Promise<void>;
  setIncludeUwp: (value: boolean) => Promise<void>;
  applyMetadataBatch: (updates: AppMetadataUpdate[]) => void;
  markEnrichmentComplete: (totalProcessed: number) => void;
  setSearchQuery: (query: string) => void;
  setActiveFilter: (filter: AppFilterKey) => void;
  setSortMode: (sort: AppSortKey) => void;
  openUninstallModal: (app: InstalledApp) => void;
  closeUninstallModal: () => void;
  openRelocateModal: (app: InstalledApp) => void;
  closeRelocateModal: () => void;
  removeAppFromList: (appId: string) => void;
  markAppRelocated: (appId: string, targetPath: string) => void;
}

export const useAppsStore = create<AppsStoreState>((set, get) => ({
  apps: [],
  hasLoadedOnce: false,
  isLoadingApps: false,
  isEnrichingMetadata: false,
  enrichedCount: 0,
  totalToEnrich: 0,
  includeUwp: true,
  searchQuery: '',
  activeFilter: 'all',
  sortMode: 'size',
  loadError: null,
  uninstallModalApp: null,
  relocateModalApp: null,

  loadApps: async (force = false) => {
    const { hasLoadedOnce, isLoadingApps, includeUwp } = get();
    if (isLoadingApps) {
      return;
    }
    if (hasLoadedOnce && !force) {
      return;
    }
    if (!isTauriRuntime()) {
      set({
        hasLoadedOnce: true,
        isLoadingApps: false,
        isEnrichingMetadata: false,
        loadError: null,
      });
      return;
    }

    set({
      isLoadingApps: true,
      loadError: null,
      enrichedCount: 0,
      totalToEnrich: 0,
    });

    try {
      const list = await fetchInstalledApps(includeUwp);
      set({
        apps: list,
        hasLoadedOnce: true,
        isLoadingApps: false,
        isEnrichingMetadata: list.length > 0,
        enrichedCount: 0,
        totalToEnrich: list.length,
        loadError: null,
      });
    } catch (err) {
      const message = extractError(err);
      set({
        isLoadingApps: false,
        isEnrichingMetadata: false,
        loadError: message,
      });
      useAppStore.getState().addToast({
        title: 'No se pudo cargar la lista de aplicaciones',
        message,
        variant: 'error',
      });
    }
  },

  setIncludeUwp: async (value) => {
    set({ includeUwp: value });
    await get().loadApps(true);
  },

  applyMetadataBatch: (updates) => {
    if (updates.length === 0) {
      return;
    }
    const updateMap = new Map<string, AppMetadataUpdate>();
    for (const item of updates) {
      updateMap.set(item.appId, item);
    }

    set((state) => {
      const nextApps = state.apps.map((app) => {
        const patch = updateMap.get(app.id);
        if (!patch) {
          return app;
        }
        return {
          ...app,
          realSizeBytes: patch.realSizeBytes ?? app.realSizeBytes,
          lastUsedTimestamp: patch.lastUsedTimestamp ?? app.lastUsedTimestamp,
          iconDataUrl: patch.iconDataUrl ?? app.iconDataUrl,
        };
      });

      const nextUninstall =
        state.uninstallModalApp && updateMap.has(state.uninstallModalApp.id)
          ? nextApps.find((a) => a.id === state.uninstallModalApp?.id) ?? state.uninstallModalApp
          : state.uninstallModalApp;

      const nextRelocate =
        state.relocateModalApp && updateMap.has(state.relocateModalApp.id)
          ? nextApps.find((a) => a.id === state.relocateModalApp?.id) ?? state.relocateModalApp
          : state.relocateModalApp;

      const nextEnrichedCount = Math.min(
        state.totalToEnrich || nextApps.length,
        state.enrichedCount + updates.length,
      );

      return {
        apps: nextApps,
        enrichedCount: nextEnrichedCount,
        uninstallModalApp: nextUninstall,
        relocateModalApp: nextRelocate,
      };
    });
  },

  markEnrichmentComplete: (totalProcessed) => {
    set((state) => ({
      isEnrichingMetadata: false,
      enrichedCount: totalProcessed || state.apps.length,
      totalToEnrich: totalProcessed || state.apps.length,
    }));
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setSortMode: (sort) => set({ sortMode: sort }),

  openUninstallModal: (app) => set({ uninstallModalApp: app }),
  closeUninstallModal: () => set({ uninstallModalApp: null }),

  openRelocateModal: (app) => set({ relocateModalApp: app }),
  closeRelocateModal: () => set({ relocateModalApp: null }),

  removeAppFromList: (appId) => {
    set((state) => ({
      apps: state.apps.filter((app) => app.id !== appId),
    }));
  },

  markAppRelocated: (appId, targetPath) => {
    set((state) => ({
      apps: state.apps.map((app) =>
        app.id === appId
          ? {
              ...app,
              isRelocated: true,
              relocatedTarget: targetPath,
              canRelocate: false,
              relocateDisabledReason: `Esta aplicación ya fue movida a ${targetPath}.`,
            }
          : app,
      ),
    }));
  },
}));
