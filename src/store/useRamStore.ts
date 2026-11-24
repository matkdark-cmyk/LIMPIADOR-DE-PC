import { create } from 'zustand';
import type {
  GroupedAppProcess,
  RamAutoConfig,
  RamHistoryPoint,
  RamOptimizeResult,
  RamSnapshot,
} from '../types';
import { formatBytes } from '../utils/format';
import {
  fetchRamAutoConfig,
  fetchRamSnapshot,
  invokeCloseProcessGroup,
  invokeOptimizeRam,
  invokeSetRamAutoConfig,
  isTauriRuntime,
} from '../utils/tauri';
import { useAppStore } from './useAppStore';

const MAX_HISTORY_POINTS = 60;
const BYTES_PER_GB = 1024 * 1024 * 1024;
const SIGNIFICANT_FREED_BYTES = 25 * 1024 * 1024; // 25 MiB

const DEFAULT_AUTO_CONFIG: RamAutoConfig = {
  enabled: false,
  thresholdPercent: 85,
  purgeStandby: false,
  cooldownMinutes: 10,
};

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'No se pudo completar la operación de memoria RAM.';
}

function buildHistoryPoint(snapshot: RamSnapshot): RamHistoryPoint {
  const date = new Date(snapshot.timestamp);
  const timeLabel = Number.isNaN(date.getTime())
    ? new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : date.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

  return {
    timeLabel,
    usagePercent: Number(snapshot.metrics.usagePercent.toFixed(1)),
    usedGb: Number((snapshot.metrics.usedBytes / BYTES_PER_GB).toFixed(2)),
    availableGb: Number((snapshot.metrics.availableBytes / BYTES_PER_GB).toFixed(2)),
    standbyGb: Number((snapshot.metrics.cachedStandbyBytes / BYTES_PER_GB).toFixed(2)),
  };
}

interface RamStoreState {
  snapshot: RamSnapshot | null;
  history: RamHistoryPoint[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  isPaused: boolean;
  isOptimizing: boolean;
  purgeStandby: boolean;
  lastOptimizeResult: RamOptimizeResult | null;
  autoConfig: RamAutoConfig;
  hasLoadedAutoConfig: boolean;
  isSavingAutoConfig: boolean;
  searchQuery: string;
  hideSystemProcesses: boolean;
  closingGroup: GroupedAppProcess | null;
  isClosingGroup: boolean;

  fetchSnapshot: (options?: { silent?: boolean }) => Promise<void>;
  loadAutoConfig: () => Promise<void>;
  updateAutoConfig: (patch: Partial<RamAutoConfig>) => Promise<void>;
  togglePaused: () => void;
  setPurgeStandby: (enabled: boolean) => void;
  runOptimize: () => Promise<void>;
  clearLastOptimizeResult: () => void;
  setSearchQuery: (query: string) => void;
  setHideSystemProcesses: (hide: boolean) => void;
  openCloseGroupModal: (group: GroupedAppProcess) => void;
  closeCloseGroupModal: () => void;
  confirmCloseGroup: () => Promise<void>;
}

export const useRamStore = create<RamStoreState>((set, get) => ({
  snapshot: null,
  history: [],
  isLoading: false,
  isFetching: false,
  error: null,
  isPaused: false,
  isOptimizing: false,
  purgeStandby: false,
  lastOptimizeResult: null,
  autoConfig: DEFAULT_AUTO_CONFIG,
  hasLoadedAutoConfig: false,
  isSavingAutoConfig: false,
  searchQuery: '',
  hideSystemProcesses: true,
  closingGroup: null,
  isClosingGroup: false,

  fetchSnapshot: async (options) => {
    if (!isTauriRuntime()) {
      return;
    }
    if (get().isFetching) {
      return;
    }

    const isFirstLoad = get().snapshot === null;
    set({
      isFetching: true,
      isLoading: isFirstLoad && !options?.silent,
      error: null,
    });

    try {
      const snapshot = await fetchRamSnapshot();
      const point = buildHistoryPoint(snapshot);

      set((state) => ({
        snapshot,
        history: [...state.history.slice(-(MAX_HISTORY_POINTS - 1)), point],
        isLoading: false,
        isFetching: false,
        error: null,
      }));
    } catch (err) {
      const message = extractErrorMessage(err);
      set({
        isLoading: false,
        isFetching: false,
        error: message,
      });
      if (!options?.silent) {
        useAppStore.getState().addToast({
          title: 'No se pudo leer la memoria RAM',
          message,
          variant: 'error',
        });
      }
    }
  },

  loadAutoConfig: async () => {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const config = await fetchRamAutoConfig();
      set({ autoConfig: config, hasLoadedAutoConfig: true });
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo cargar la regla automática de RAM',
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },

  updateAutoConfig: async (patch) => {
    const previous = get().autoConfig;
    const next: RamAutoConfig = { ...previous, ...patch };
    set({ autoConfig: next, isSavingAutoConfig: true });

    if (!isTauriRuntime()) {
      set({ isSavingAutoConfig: false });
      return;
    }

    try {
      const saved = await invokeSetRamAutoConfig(next);
      set({ autoConfig: saved, isSavingAutoConfig: false });
      useAppStore.getState().addToast({
        title: saved.enabled
          ? `Auto-optimización activada (${saved.thresholdPercent}%)`
          : 'Auto-optimización desactivada',
        message: saved.enabled
          ? `DiskVault Clean liberará memoria como máximo una vez cada ${saved.cooldownMinutes} minutos si superas ${saved.thresholdPercent}%.`
          : 'Tu configuración quedó guardada en la base de datos local.',
        variant: 'success',
      });
    } catch (err) {
      set({ autoConfig: previous, isSavingAutoConfig: false });
      useAppStore.getState().addToast({
        title: 'No se pudo guardar la regla automática',
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },

  togglePaused: () => {
    set((state) => ({ isPaused: !state.isPaused }));
  },

  setPurgeStandby: (enabled) => {
    set({ purgeStandby: enabled });
  },

  runOptimize: async () => {
    if (!isTauriRuntime() || get().isOptimizing) {
      return;
    }

    const { purgeStandby, snapshot } = get();
    const shouldPurgeStandby = purgeStandby && Boolean(snapshot?.isAdmin);

    set({ isOptimizing: true });
    try {
      const result = await invokeOptimizeRam(shouldPurgeStandby, []);
      set({ lastOptimizeResult: result, isOptimizing: false });

      const totalRecovered = result.freedBytes + result.standbyFreedBytes;
      const beforePct = Math.round(result.before.usagePercent);
      const afterPct = Math.round(result.after.usagePercent);

      if (totalRecovered >= SIGNIFICANT_FREED_BYTES) {
        useAppStore.getState().addToast({
          title: `¡Listo! Se liberaron ${formatBytes(totalRecovered)}`,
          message: `El uso de RAM pasó de ${beforePct}% a ${afterPct}%.`,
          variant: 'success',
          durationMs: 5500,
        });
      } else {
        useAppStore.getState().addToast({
          title: 'Memoria revisada',
          message:
            totalRecovered > 0
              ? `Tu memoria ya estaba bien optimizada (se recuperaron ${formatBytes(totalRecovered)}).`
              : 'Tu memoria ya estaba bien optimizada.',
          variant: 'info',
          durationMs: 5000,
        });
      }

      // Actualizar métricas y auditoría inmediatamente
      await Promise.all([
        get().fetchSnapshot({ silent: true }),
        useAppStore.getState().refreshAuditLogs(10),
      ]);
    } catch (err) {
      set({ isOptimizing: false });
      useAppStore.getState().addToast({
        title: 'No se pudo optimizar la memoria RAM',
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },

  clearLastOptimizeResult: () => {
    set({ lastOptimizeResult: null });
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setHideSystemProcesses: (hide) => {
    set({ hideSystemProcesses: hide });
  },

  openCloseGroupModal: (group) => {
    if (group.isSystemCritical || group.isSelf) {
      return;
    }
    set({ closingGroup: group });
  },

  closeCloseGroupModal: () => {
    if (get().isClosingGroup) {
      return;
    }
    set({ closingGroup: null });
  },

  confirmCloseGroup: async () => {
    const group = get().closingGroup;
    if (!group || !isTauriRuntime() || get().isClosingGroup) {
      return;
    }

    const pids = group.children.map((child) => child.pid);
    set({ isClosingGroup: true });

    try {
      const res = await invokeCloseProcessGroup(pids, group.displayName);
      set({ isClosingGroup: false, closingGroup: null });

      useAppStore.getState().addToast({
        title:
          res.closedCount > 0
            ? `${group.displayName} cerrada`
            : `No se pudo cerrar ${group.displayName}`,
        message: res.message,
        variant: res.closedCount > 0 ? 'success' : 'warning',
      });

      await Promise.all([
        get().fetchSnapshot({ silent: true }),
        useAppStore.getState().refreshAuditLogs(10),
      ]);
    } catch (err) {
      set({ isClosingGroup: false });
      useAppStore.getState().addToast({
        title: `Error al cerrar ${group.displayName}`,
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },
}));
