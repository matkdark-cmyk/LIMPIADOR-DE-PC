import { create } from 'zustand';
import type {
  NasConnectionStatus,
  NasTarget,
  ThreatScanReport,
  TransferHistoryEntry,
  TransferMode,
  TransferPreflight,
  TransferProgress,
  TransferResult,
} from '../types';
import { formatBytes } from '../utils/format';
import {
  fetchNasTargets,
  fetchTransferHistory,
  invokeCancelTransfer,
  invokeDeleteNasTarget,
  invokePauseTransfer,
  invokePreviewTransferSource,
  invokeRecordThreatDecision,
  invokeResumeTransfer,
  invokeSaveNasTarget,
  invokeScanTransferThreats,
  invokeStartSafeTransfer,
  invokeTestNasConnection,
  isTauriRuntime,
  pickFolderDialog,
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
  return 'Ocurrió un error inesperado durante la operación con el destino.';
}

export type NasSectionTab = 'wizard' | 'targets' | 'history';

interface NasStoreState {
  activeSubTab: NasSectionTab;
  targets: NasTarget[];
  isLoadingTargets: boolean;
  history: TransferHistoryEntry[];
  isLoadingHistory: boolean;

  testingTargetPath: string | null;
  lastConnectionTest: { path: string; status: NasConnectionStatus } | null;

  sourcePath: string;
  destRoot: string;
  mode: TransferMode;
  sendLocalToTrash: boolean;

  preflight: TransferPreflight | null;
  isCheckingPreflight: boolean;
  preflightError: string | null;

  isScanPromptOpen: boolean;
  isScanningThreats: boolean;
  pendingThreatReport: ThreatScanReport | null;
  stoppedThreatReport: ThreatScanReport | null;

  isTransferring: boolean;
  isPaused: boolean;
  transferProgress: TransferProgress | null;
  lastTransferResult: TransferResult | null;
  lastTransferError: string | null;

  setActiveSubTab: (tab: NasSectionTab) => void;
  loadTargetsAndHistory: () => Promise<void>;
  saveTarget: (name: string, path: string) => Promise<boolean>;
  deleteTarget: (id: number) => Promise<void>;
  testConnection: (params: {
    path: string;
    username?: string;
    password?: string;
    rememberInWindows: boolean;
  }) => Promise<NasConnectionStatus | null>;

  setSourcePath: (path: string) => void;
  setDestRoot: (path: string) => void;
  setMode: (mode: TransferMode) => void;
  setSendLocalToTrash: (value: boolean) => void;
  pickSourceFolder: () => Promise<void>;
  pickDestFolder: () => Promise<void>;
  runPreflight: () => Promise<void>;

  requestStartTransfer: () => void;
  closeScanPrompt: () => void;
  confirmTransferWithVirusScan: () => Promise<void>;
  confirmTransferWithoutVirusScan: () => Promise<void>;
  startTransfer: (bypassThreatWarning?: boolean) => Promise<void>;
  stopTransferDueToThreats: () => Promise<void>;
  acceptThreatsAndContinue: () => Promise<void>;
  clearStoppedThreatReport: () => void;
  togglePauseTransfer: () => Promise<void>;
  cancelTransfer: () => Promise<void>;
  setTransferProgress: (progress: TransferProgress) => void;
  clearLastTransferBanner: () => void;
}

export const useNasStore = create<NasStoreState>((set, get) => ({
  activeSubTab: 'wizard',
  targets: [],
  isLoadingTargets: false,
  history: [],
  isLoadingHistory: false,

  testingTargetPath: null,
  lastConnectionTest: null,

  sourcePath: '',
  destRoot: '',
  mode: 'archive_free',
  sendLocalToTrash: false,

  preflight: null,
  isCheckingPreflight: false,
  preflightError: null,

  isScanPromptOpen: false,
  isScanningThreats: false,
  pendingThreatReport: null,
  stoppedThreatReport: null,

  isTransferring: false,
  isPaused: false,
  transferProgress: null,
  lastTransferResult: null,
  lastTransferError: null,

  setActiveSubTab: (tab) => set({ activeSubTab: tab }),

  loadTargetsAndHistory: async () => {
    if (!isTauriRuntime()) {
      return;
    }
    set({ isLoadingTargets: true, isLoadingHistory: true });
    try {
      const [targets, history] = await Promise.all([
        fetchNasTargets(),
        fetchTransferHistory(50),
      ]);
      const currentDest = get().destRoot;
      set({
        targets,
        history,
        isLoadingTargets: false,
        isLoadingHistory: false,
        destRoot: currentDest || targets[0]?.path || '',
      });
    } catch (err) {
      set({ isLoadingTargets: false, isLoadingHistory: false });
      useAppStore.getState().addToast({
        title: 'No se pudieron cargar destinos e historial',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  saveTarget: async (name, path) => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Guardado disponible en Windows',
        message: 'Ejecuta DiskVault Clean en escritorio para guardar destinos NAS en SQLite.',
        variant: 'info',
      });
      return false;
    }

    try {
      const created = await invokeSaveNasTarget(name, path);
      set((state) => ({
        targets: [created, ...state.targets],
        destRoot: state.destRoot || created.path,
      }));
      useAppStore.getState().addToast({
        title: 'Destino guardado',
        message: `"${created.name}" ya está listo para tus migraciones seguras.`,
        variant: 'success',
      });
      void useAppStore.getState().refreshAuditLogs(5);
      return true;
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo guardar el destino',
        message: extractError(err),
        variant: 'error',
      });
      return false;
    }
  },

  deleteTarget: async (id) => {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invokeDeleteNasTarget(id);
      set((state) => ({
        targets: state.targets.filter((t) => t.id !== id),
      }));
      useAppStore.getState().addToast({
        title: 'Destino eliminado',
        message: 'Se quitó el destino de tu lista guardada.',
        variant: 'info',
      });
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo eliminar el destino',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  testConnection: async (params) => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Prueba SMB/NAS disponible en Windows',
        message: 'Ejecuta "npm run tauri dev" en Windows para verificar rutas UNC y permisos reales.',
        variant: 'info',
      });
      return null;
    }

    set({ testingTargetPath: params.path });
    try {
      const status = await invokeTestNasConnection(params);
      set({
        testingTargetPath: null,
        lastConnectionTest: { path: params.path, status },
      });

      if (status.reachable && status.writable) {
        useAppStore.getState().addToast({
          title: 'Conexión verificada correctamente',
          message: `${status.message} Espacio libre: ${formatBytes(status.freeBytes)}.`,
          variant: 'success',
        });
        // Refresca la lista para reflejar lastFreeBytes / lastTestedAt
        const targets = await fetchNasTargets();
        set({ targets });
      } else {
        useAppStore.getState().addToast({
          title: status.reachable ? 'Sin permisos de escritura' : 'Destino no accesible',
          message: status.message,
          variant: 'warning',
          durationMs: 6500,
        });
      }
      return status;
    } catch (err) {
      set({ testingTargetPath: null });
      useAppStore.getState().addToast({
        title: 'Error al probar la conexión',
        message: extractError(err),
        variant: 'error',
        durationMs: 6500,
      });
      return null;
    }
  },

  setSourcePath: (path) =>
    set({
      sourcePath: path,
      preflight: null,
      preflightError: null,
      stoppedThreatReport: null,
    }),

  setDestRoot: (path) =>
    set({ destRoot: path, preflight: null, preflightError: null }),

  setMode: (mode) => set({ mode }),

  setSendLocalToTrash: (value) => set({ sendLocalToTrash: value }),

  pickSourceFolder: async () => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Selector nativo disponible en Windows',
        message: 'Usa "npm run tauri dev" en Windows para seleccionar una carpeta real.',
        variant: 'info',
      });
      return;
    }
    try {
      const folder = await pickFolderDialog('Elegir carpeta de origen para mover al NAS');
      if (folder) {
        set({ sourcePath: folder, preflight: null, preflightError: null });
      }
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo abrir el selector',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  pickDestFolder: async () => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Selector nativo disponible en Windows',
        message: 'Usa "npm run tauri dev" en Windows para elegir una carpeta destino.',
        variant: 'info',
      });
      return;
    }
    try {
      const folder = await pickFolderDialog('Elegir carpeta de destino (NAS o disco)');
      if (folder) {
        set({ destRoot: folder, preflight: null, preflightError: null });
      }
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo abrir el selector',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  runPreflight: async () => {
    const { sourcePath, destRoot } = get();
    if (!sourcePath.trim() || !destRoot.trim()) {
      set({
        preflight: null,
        preflightError: 'Selecciona tanto una carpeta de origen como un destino antes de verificar.',
      });
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }

    set({ isCheckingPreflight: true, preflightError: null });
    try {
      const result = await invokePreviewTransferSource(sourcePath.trim(), destRoot.trim());
      set({ preflight: result, isCheckingPreflight: false, preflightError: null });
    } catch (err) {
      set({
        preflight: null,
        isCheckingPreflight: false,
        preflightError: extractError(err),
      });
    }
  },

  requestStartTransfer: () => {
    const { sourcePath, destRoot, isTransferring, isScanningThreats } = get();
    if (isTransferring || isScanningThreats) {
      return;
    }
    if (!sourcePath.trim() || !destRoot.trim()) {
      useAppStore.getState().addToast({
        title: 'Faltan rutas de origen o destino',
        message: 'Completa el origen y el destino antes de iniciar la migración segura.',
        variant: 'warning',
      });
      return;
    }
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Migrador disponible en la app de Windows',
        message: 'Ejecuta "npm run tauri dev" en Windows para iniciar transferencias reales con xxHash3.',
        variant: 'info',
      });
      return;
    }
    set({ isScanPromptOpen: true });
  },

  closeScanPrompt: () => set({ isScanPromptOpen: false }),

  confirmTransferWithVirusScan: async () => {
    set({ isScanPromptOpen: false });
    await get().startTransfer(false);
  },

  confirmTransferWithoutVirusScan: async () => {
    set({ isScanPromptOpen: false });
    await get().startTransfer(true);
  },

  startTransfer: async (bypassThreatWarning = false) => {
    const { sourcePath, destRoot, mode, sendLocalToTrash, isTransferring, isScanningThreats } =
      get();
    if (isTransferring || isScanningThreats) {
      return;
    }
    if (!sourcePath.trim() || !destRoot.trim()) {
      useAppStore.getState().addToast({
        title: 'Faltan rutas de origen o destino',
        message: 'Completa el origen y el destino antes de iniciar la migración segura.',
        variant: 'warning',
      });
      return;
    }
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Migrador disponible en la app de Windows',
        message: 'Ejecuta "npm run tauri dev" en Windows para iniciar transferencias reales con xxHash3.',
        variant: 'info',
      });
      return;
    }

    // Fase de seguridad previa: detectar virus o archivos sospechosos antes de copiar al disco o NAS
    if (!bypassThreatWarning) {
      set({
        isScanningThreats: true,
        pendingThreatReport: null,
        stoppedThreatReport: null,
        lastTransferError: null,
      });

      try {
        const threatReport = await invokeScanTransferThreats(sourcePath.trim());
        set({ isScanningThreats: false });

        if (threatReport.hasThreats && threatReport.findings.length > 0) {
          set({ pendingThreatReport: threatReport });
          return;
        }
      } catch (err) {
        set({ isScanningThreats: false });
        useAppStore.getState().addToast({
          title: 'No se pudo completar el análisis previo de seguridad',
          message: extractError(err),
          variant: 'error',
          durationMs: 7000,
        });
        return;
      }
    }

    set({
      isTransferring: true,
      isPaused: false,
      pendingThreatReport: null,
      stoppedThreatReport: null,
      lastTransferResult: null,
      lastTransferError: null,
      transferProgress: {
        phase: 'preparing',
        paused: false,
        currentFile: 'Preparando lista de archivos...',
        filesCompleted: 0,
        filesTotal: 0,
        bytesProcessed: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: null,
        percent: 0,
        retriesCount: 0,
      },
    });

    try {
      const result = await invokeStartSafeTransfer({
        sourcePath: sourcePath.trim(),
        destRoot: destRoot.trim(),
        mode,
        sendLocalToTrash,
      });

      set({
        isTransferring: false,
        isPaused: false,
        lastTransferResult: result,
        lastTransferError: null,
        preflight: null,
      });

      // Limpiar cola pendiente proveniente del Explorador si coincide
      useScannerStore.getState().clearPendingNasSourcePath();

      // Refrescar historial, discos en Dashboard y auditoría
      void get().loadTargetsAndHistory();
      void useScannerStore.getState().loadSystemOverview(true);
      void useAppStore.getState().refreshAuditLogs(5);

      useAppStore.getState().addToast({
        title: 'Migración verificada con xxHash3',
        message: result.summaryMessage,
        variant: 'success',
        durationMs: 6500,
      });
    } catch (err) {
      const message = extractError(err);
      const isCancelled = message.toLowerCase().includes('cancel');
      set({
        isTransferring: false,
        isPaused: false,
        lastTransferResult: null,
        lastTransferError: message,
      });

      void get().loadTargetsAndHistory();
      void useAppStore.getState().refreshAuditLogs(5);

      useAppStore.getState().addToast({
        title: isCancelled
          ? 'Transferencia cancelada (origen intacto)'
          : 'Transferencia detenida por seguridad',
        message,
        variant: isCancelled ? 'warning' : 'error',
        durationMs: 8000,
      });
    }
  },

  stopTransferDueToThreats: async () => {
    const { pendingThreatReport, sourcePath, destRoot } = get();
    if (!pendingThreatReport) {
      return;
    }
    const summary = pendingThreatReport.findings
      .slice(0, 3)
      .map((f) => `${f.fileName} (${f.threatName})`)
      .join(', ');

    set({
      pendingThreatReport: null,
      stoppedThreatReport: pendingThreatReport,
    });

    if (isTauriRuntime()) {
      try {
        await invokeRecordThreatDecision({
          sourcePath: sourcePath.trim(),
          destRoot: destRoot.trim(),
          continuedByUser: false,
          findingsCount: pendingThreatReport.findings.length,
          summary,
        });
        void useAppStore.getState().refreshAuditLogs(5);
      } catch {
        // No bloquear al usuario si el registro secundario falla
      }
    }

    useAppStore.getState().addToast({
      title: 'Copiado detenido por seguridad',
      message: `Se detectaron ${pendingThreatReport.findings.length} archivo(s) sospechosos o con riesgo. Revisa las rutas detalladas en pantalla antes de volver a intentar.`,
      variant: 'warning',
      durationMs: 8000,
    });
  },

  acceptThreatsAndContinue: async () => {
    const { pendingThreatReport, sourcePath, destRoot } = get();
    if (!pendingThreatReport) {
      return;
    }
    const summary = pendingThreatReport.findings
      .slice(0, 3)
      .map((f) => `${f.fileName} (${f.threatName})`)
      .join(', ');

    set({
      pendingThreatReport: null,
      stoppedThreatReport: null,
    });

    if (isTauriRuntime()) {
      try {
        await invokeRecordThreatDecision({
          sourcePath: sourcePath.trim(),
          destRoot: destRoot.trim(),
          continuedByUser: true,
          findingsCount: pendingThreatReport.findings.length,
          summary,
        });
      } catch {
        // Continuar incluso si falla el log
      }
    }

    await get().startTransfer(true);
  },

  clearStoppedThreatReport: () => set({ stoppedThreatReport: null }),

  togglePauseTransfer: async () => {
    if (!get().isTransferring || !isTauriRuntime()) {
      return;
    }
    const nextPaused = !get().isPaused;
    try {
      if (nextPaused) {
        await invokePauseTransfer();
      } else {
        await invokeResumeTransfer();
      }
      set((state) => ({
        isPaused: nextPaused,
        transferProgress: state.transferProgress
          ? { ...state.transferProgress, paused: nextPaused }
          : null,
      }));
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo cambiar el estado de pausa',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  cancelTransfer: async () => {
    if (!get().isTransferring || !isTauriRuntime()) {
      return;
    }
    try {
      await invokeCancelTransfer();
      set({ isPaused: false });
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo cancelar la transferencia',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  setTransferProgress: (progress) => {
    set({
      transferProgress: progress,
      isPaused: progress.paused,
    });
  },

  clearLastTransferBanner: () => {
    set({
      lastTransferResult: null,
      lastTransferError: null,
      transferProgress: null,
    });
  },
}));
