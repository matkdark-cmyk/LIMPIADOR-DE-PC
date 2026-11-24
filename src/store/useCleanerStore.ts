import { create } from 'zustand';
import type {
  CacheCleanProgress,
  CacheCleanResult,
  CacheScanProgress,
  CacheScanReport,
  InactiveDaysOption,
} from '../types';
import { formatBytes } from '../utils/format';
import {
  invokeCloseCleanerBlockingApps,
  invokeExecuteCacheClean,
  invokeScanCacheTargets,
  isTauriRuntime,
} from '../utils/tauri';
import { useAppStore } from './useAppStore';
import { useScannerStore } from './useScannerStore';

function extractError(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al analizar o limpiar la caché.';
}

interface CleanerStoreState {
  report: CacheScanReport | null;
  hasScannedOnce: boolean;
  isScanning: boolean;
  scanProgress: CacheScanProgress | null;
  scanError: string | null;

  inactiveDaysThreshold: InactiveDaysOption;
  useRecycleBin: boolean;
  selectedIds: Record<string, boolean>;
  closingTargetId: string | null;

  isCleaning: boolean;
  cleanProgress: CacheCleanProgress | null;
  lastResult: CacheCleanResult | null;
  confirmModalOpen: boolean;

  scanCaches: (force?: boolean) => Promise<void>;
  setInactiveDaysThreshold: (days: InactiveDaysOption) => Promise<void>;
  setUseRecycleBin: (value: boolean) => void;
  toggleTarget: (targetId: string) => void;
  selectAllSafe: () => void;
  deselectAll: () => void;
  closeBlockingApps: (targetId: string, processNames: string[]) => Promise<void>;
  openConfirmModal: () => void;
  closeConfirmModal: () => void;
  runCleanup: (closeRunningApps: boolean) => Promise<void>;
  setScanProgress: (progress: CacheScanProgress) => void;
  setCleanProgress: (progress: CacheCleanProgress) => void;
  clearLastResult: () => void;
}

export const useCleanerStore = create<CleanerStoreState>((set, get) => ({
  report: null,
  hasScannedOnce: false,
  isScanning: false,
  scanProgress: null,
  scanError: null,

  inactiveDaysThreshold: 30,
  useRecycleBin: true,
  selectedIds: {},
  closingTargetId: null,

  isCleaning: false,
  cleanProgress: null,
  lastResult: null,
  confirmModalOpen: false,

  scanCaches: async (force = false) => {
    const { hasScannedOnce, isScanning, inactiveDaysThreshold } = get();
    if (isScanning) {
      return;
    }
    if (hasScannedOnce && !force) {
      return;
    }
    if (!isTauriRuntime()) {
      set({ hasScannedOnce: true, isScanning: false, scanError: null });
      return;
    }

    set({
      isScanning: true,
      scanError: null,
      scanProgress: {
        currentGroup: 'Sistema Windows',
        scannedTargets: 0,
        totalTargets: 1,
        bytesFound: 0,
      },
    });

    try {
      const report = await invokeScanCacheTargets(inactiveDaysThreshold);
      const initialSelection: Record<string, boolean> = {};
      for (const target of report.targets) {
        initialSelection[target.id] = target.defaultSelected;
      }
      set({
        report,
        selectedIds: initialSelection,
        hasScannedOnce: true,
        isScanning: false,
        scanProgress: null,
        scanError: null,
      });
    } catch (err) {
      const msg = extractError(err);
      set({ isScanning: false, scanProgress: null, scanError: msg });
      useAppStore.getState().addToast({
        title: 'No se pudo analizar el espacio recuperable',
        message: msg,
        variant: 'error',
      });
    }
  },

  setInactiveDaysThreshold: async (days) => {
    set({ inactiveDaysThreshold: days });
    if (get().hasScannedOnce && isTauriRuntime()) {
      await get().scanCaches(true);
    }
  },

  setUseRecycleBin: (value) => set({ useRecycleBin: value }),

  toggleTarget: (targetId) => {
    const report = get().report;
    if (!report) {
      return;
    }
    const target = report.targets.find((t) => t.id === targetId);
    if (!target) {
      return;
    }
    if (target.safety === 'protected' || (target.requiresAdmin && !report.isAdmin)) {
      return;
    }
    set((state) => ({
      selectedIds: {
        ...state.selectedIds,
        [targetId]: !state.selectedIds[targetId],
      },
    }));
  },

  selectAllSafe: () => {
    const report = get().report;
    if (!report) {
      return;
    }
    const next: Record<string, boolean> = {};
    for (const target of report.targets) {
      next[target.id] = target.defaultSelected;
    }
    set({ selectedIds: next });
  },

  deselectAll: () => {
    set({ selectedIds: {} });
  },

  closeBlockingApps: async (targetId, processNames) => {
    if (!isTauriRuntime() || processNames.length === 0) {
      return;
    }
    set({ closingTargetId: targetId });
    try {
      const closedCount = await invokeCloseCleanerBlockingApps(processNames);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      set({ closingTargetId: null });
      await get().scanCaches(true);

      useAppStore.getState().addToast({
        title: closedCount > 0 ? 'Aplicación cerrada correctamente' : 'No se cerraron procesos',
        message:
          closedCount > 0
            ? 'Ahora su caché se puede limpiar al 100%.'
            : 'La aplicación ya estaba cerrada o no respondió al cierre.',
        variant: closedCount > 0 ? 'success' : 'info',
      });
    } catch (err) {
      set({ closingTargetId: null });
      useAppStore.getState().addToast({
        title: 'No se pudo cerrar la aplicación',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  openConfirmModal: () => set({ confirmModalOpen: true }),
  closeConfirmModal: () => set({ confirmModalOpen: false }),

  runCleanup: async (closeRunningApps) => {
    const { report, selectedIds, useRecycleBin, isCleaning } = get();
    if (!report || isCleaning || !isTauriRuntime()) {
      return;
    }

    const chosenIds = report.targets
      .filter((t) => selectedIds[t.id] && t.safety !== 'protected')
      .map((t) => t.id);

    if (chosenIds.length === 0) {
      return;
    }

    set({
      confirmModalOpen: false,
      isCleaning: true,
      lastResult: null,
      cleanProgress: {
        currentTargetName: 'Preparando limpieza segura...',
        targetsDone: 0,
        targetsTotal: chosenIds.length,
        bytesFreedSoFar: 0,
      },
    });

    try {
      const res = await invokeExecuteCacheClean(chosenIds, useRecycleBin, closeRunningApps);
      set({
        isCleaning: false,
        lastResult: res,
        cleanProgress: null,
      });

      useAppStore.getState().addToast({
        title: '¡Limpieza completada!',
        message: `Se liberaron ${formatBytes(res.bytesFreed)} (${res.filesDeleted} archivos).`,
        variant: 'success',
        durationMs: 6500,
      });

      void useScannerStore.getState().loadSystemOverview(true);
      void useAppStore.getState().refreshAuditLogs(5);
      await get().scanCaches(true);
    } catch (err) {
      set({
        isCleaning: false,
        cleanProgress: null,
      });
      useAppStore.getState().addToast({
        title: 'No se pudo completar la limpieza',
        message: extractError(err),
        variant: 'error',
        durationMs: 6500,
      });
    }
  },

  setScanProgress: (progress) => set({ scanProgress: progress }),
  setCleanProgress: (progress) => set({ cleanProgress: progress }),
  clearLastResult: () => set({ lastResult: null }),
}));
