import { create } from 'zustand';
import type {
  AnalyzerTab,
  FileNode,
  FileSection,
  ScanProgress,
  ScanSummary,
  SystemOverview,
} from '../types';
import { formatBytes } from '../utils/format';
import {
  fetchFilesBySection,
  fetchFolderChildren,
  fetchScanSummary,
  fetchSystemOverview,
  invokeCancelDiskScan,
  invokeDeleteItemToTrash,
  invokeOpenInExplorer,
  invokeStartDiskScan,
  isTauriRuntime,
  pickFolderDialog,
} from '../utils/tauri';
import { useAppStore } from './useAppStore';

function extractError(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al comunicarse con el motor de disco.';
}

function getParentDirectoryPath(currentPath: string, rootPath: string): string | null {
  const normCurrent = currentPath.replace(/\//g, '\\').replace(/\\+$/, '');
  const normRoot = rootPath.replace(/\//g, '\\').replace(/\\+$/, '');

  if (normCurrent.toLowerCase() === normRoot.toLowerCase()) {
    return null;
  }

  const lastSlash = normCurrent.lastIndexOf('\\');
  if (lastSlash < 0) {
    return rootPath;
  }

  // Si subimos a raíz de unidad ("C:"), agregamos barra final ("C:\")
  const candidate =
    lastSlash === 2 && normCurrent[1] === ':'
      ? `${normCurrent.slice(0, 2)}\\`
      : normCurrent.slice(0, lastSlash);

  if (candidate.toLowerCase().length < normRoot.toLowerCase().length) {
    return rootPath;
  }
  return candidate;
}

interface ScannerStoreState {
  systemOverview: SystemOverview | null;
  isLoadingOverview: boolean;
  overviewError: string | null;

  selectedRootPath: string;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  scanError: string | null;
  scanSummary: ScanSummary | null;

  activeTab: AnalyzerTab;
  currentFolderPath: string;
  currentFolderChildren: FileNode[];
  isLoadingChildren: boolean;
  searchQuery: string;

  selectedSection: FileSection;
  sectionFiles: FileNode[];
  isLoadingSectionFiles: boolean;

  pendingTrashNode: FileNode | null;
  isDeletingToTrash: boolean;

  pendingNasSourcePath: string | null;

  loadSystemOverview: (silent?: boolean) => Promise<void>;
  setSelectedRootPath: (path: string) => void;
  chooseFolderFromDialog: () => Promise<void>;
  startScan: (overrideRootPath?: string) => Promise<void>;
  analyzeDriveFromDashboard: (mountPoint: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  setScanProgress: (progress: ScanProgress) => void;

  setActiveTab: (tab: AnalyzerTab) => void;
  openFolder: (folderPath: string) => Promise<void>;
  goUpFolder: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  selectSection: (section: FileSection, switchTab?: boolean) => Promise<void>;

  openInExplorer: (path: string) => Promise<void>;
  copyPathToClipboard: (path: string) => Promise<void>;
  requestTrashDelete: (node: FileNode) => void;
  cancelTrashDelete: () => void;
  confirmTrashDelete: () => Promise<void>;
  sendPathToNas: (path: string) => void;
  clearPendingNasSourcePath: () => void;
}

export const useScannerStore = create<ScannerStoreState>((set, get) => ({
  systemOverview: null,
  isLoadingOverview: false,
  overviewError: null,

  selectedRootPath: 'C:\\',
  isScanning: false,
  scanProgress: null,
  scanError: null,
  scanSummary: null,

  activeTab: 'tree',
  currentFolderPath: '',
  currentFolderChildren: [],
  isLoadingChildren: false,
  searchQuery: '',

  selectedSection: 'AppsAndGames',
  sectionFiles: [],
  isLoadingSectionFiles: false,

  pendingTrashNode: null,
  isDeletingToTrash: false,

  pendingNasSourcePath: null,

  loadSystemOverview: async (silent = false) => {
    if (!isTauriRuntime()) {
      set({ isLoadingOverview: false, systemOverview: null, overviewError: null });
      return;
    }

    set({ isLoadingOverview: true, overviewError: null });
    try {
      const overview = await fetchSystemOverview();
      const currentSelected = get().selectedRootPath;
      const firstDisk = overview.disks[0]?.mountPoint ?? 'C:\\';
      const hasCurrent = overview.disks.some(
        (d) => d.mountPoint.toLowerCase() === currentSelected.toLowerCase(),
      );

      set({
        systemOverview: overview,
        isLoadingOverview: false,
        overviewError: null,
        selectedRootPath:
          currentSelected && (hasCurrent || currentSelected.length > 3)
            ? currentSelected
            : firstDisk,
      });
    } catch (err) {
      const message = extractError(err);
      set({ isLoadingOverview: false, overviewError: message });
      if (!silent) {
        useAppStore.getState().addToast({
          title: 'No se pudo leer el estado de discos y RAM',
          message,
          variant: 'error',
        });
      }
    }
  },

  setSelectedRootPath: (path) => {
    set({ selectedRootPath: path });
  },

  chooseFolderFromDialog: async () => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Selector nativo disponible en Windows',
        message: 'Ejecuta la app con "npm run tauri dev" para elegir una carpeta real de tu PC.',
        variant: 'info',
      });
      return;
    }

    try {
      const folder = await pickFolderDialog();
      if (folder) {
        set({ selectedRootPath: folder });
      }
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo abrir el selector de carpetas',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  startScan: async (overrideRootPath) => {
    const targetPath = (overrideRootPath ?? get().selectedRootPath).trim();
    if (!targetPath) {
      useAppStore.getState().addToast({
        title: 'Selecciona una unidad o carpeta',
        message: 'Elige un disco o escribe una ruta válida antes de iniciar el escaneo.',
        variant: 'warning',
      });
      return;
    }

    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Escaneo nativo disponible en Windows',
        message: 'Abre DiskVault Clean con "npm run tauri dev" para analizar discos reales.',
        variant: 'info',
      });
      return;
    }

    if (get().isScanning) {
      return;
    }

    set({
      selectedRootPath: targetPath,
      isScanning: true,
      scanError: null,
      scanProgress: {
        filesScanned: 0,
        dirsScanned: 0,
        bytesScanned: 0,
        currentPath: targetPath,
        elapsedMs: 0,
      },
    });

    try {
      const summary = await invokeStartDiskScan(targetPath);
      const topSection = summary.sections[0]?.section ?? 'AppsAndGames';

      set({
        isScanning: false,
        scanSummary: summary,
        currentFolderPath: summary.rootPath,
        currentFolderChildren: summary.rootChildren,
        searchQuery: '',
        selectedSection: topSection,
        scanError: null,
      });

      // Carga inicial de archivos de la sección más pesada en segundo plano
      void get().selectSection(topSection, false);

      useAppStore.getState().addToast({
        title: 'Escaneo completado',
        message: `Se analizaron ${summary.totalFiles.toLocaleString('es-ES')} archivos (${formatBytes(summary.totalBytes)}).`,
        variant: 'success',
      });
    } catch (err) {
      const message = extractError(err);
      const wasCancelled = message.toLowerCase().includes('cancel');
      set({
        isScanning: false,
        scanError: wasCancelled ? null : message,
      });
      useAppStore.getState().addToast({
        title: wasCancelled ? 'Escaneo cancelado' : 'Error al escanear el disco',
        message,
        variant: wasCancelled ? 'warning' : 'error',
      });
    }
  },

  analyzeDriveFromDashboard: async (mountPoint) => {
    useAppStore.getState().setActiveRoute('analyzer');
    await get().startScan(mountPoint);
  },

  cancelScan: async () => {
    if (!get().isScanning || !isTauriRuntime()) {
      return;
    }
    try {
      await invokeCancelDiskScan();
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo cancelar el escaneo',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  setScanProgress: (progress) => {
    if (get().isScanning) {
      set({ scanProgress: progress });
    }
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    if (tab === 'sections' && get().scanSummary && get().sectionFiles.length === 0) {
      void get().selectSection(get().selectedSection, false);
    }
  },

  openFolder: async (folderPath) => {
    if (!isTauriRuntime()) {
      return;
    }
    set({ isLoadingChildren: true });
    try {
      const children = await fetchFolderChildren(folderPath);
      set({
        currentFolderPath: folderPath,
        currentFolderChildren: children,
        searchQuery: '',
        isLoadingChildren: false,
      });
    } catch (err) {
      set({ isLoadingChildren: false });
      useAppStore.getState().addToast({
        title: 'No se pudo abrir la carpeta',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  goUpFolder: async () => {
    const { currentFolderPath, scanSummary } = get();
    if (!scanSummary || !currentFolderPath) {
      return;
    }
    const parent = getParentDirectoryPath(currentFolderPath, scanSummary.rootPath);
    if (parent) {
      await get().openFolder(parent);
    }
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  selectSection: async (section, switchTab = true) => {
    set((state) => ({
      selectedSection: section,
      activeTab: switchTab ? 'sections' : state.activeTab,
      isLoadingSectionFiles: true,
    }));

    if (!isTauriRuntime() || !get().scanSummary) {
      set({ isLoadingSectionFiles: false, sectionFiles: [] });
      return;
    }

    try {
      const files = await fetchFilesBySection(section, 200);
      set({ sectionFiles: files, isLoadingSectionFiles: false });
    } catch (err) {
      set({ isLoadingSectionFiles: false });
      useAppStore.getState().addToast({
        title: 'No se pudieron cargar los archivos de esta sección',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  openInExplorer: async (path) => {
    if (!isTauriRuntime()) {
      useAppStore.getState().addToast({
        title: 'Acción nativa de Windows',
        message: 'Abrir en el Explorador funciona al ejecutar DiskVault Clean en escritorio.',
        variant: 'info',
      });
      return;
    }

    try {
      await invokeOpenInExplorer(path);
    } catch (err) {
      useAppStore.getState().addToast({
        title: 'No se pudo abrir el Explorador',
        message: extractError(err),
        variant: 'error',
      });
    }
  },

  copyPathToClipboard: async (path) => {
    try {
      await navigator.clipboard.writeText(path);
      useAppStore.getState().addToast({
        title: 'Ruta copiada',
        message: path,
        variant: 'success',
        durationMs: 3000,
      });
    } catch {
      useAppStore.getState().addToast({
        title: 'No se pudo copiar al portapapeles',
        message: 'Intenta seleccionar la ruta manualmente.',
        variant: 'warning',
      });
    }
  },

  requestTrashDelete: (node) => {
    if (node.isProtected) {
      useAppStore.getState().addToast({
        title: 'Elemento protegido del sistema',
        message: 'Por seguridad, DiskVault Clean nunca permite eliminar archivos críticos de Windows.',
        variant: 'error',
      });
      return;
    }
    set({ pendingTrashNode: node });
  },

  cancelTrashDelete: () => {
    if (!get().isDeletingToTrash) {
      set({ pendingTrashNode: null });
    }
  },

  confirmTrashDelete: async () => {
    const node = get().pendingTrashNode;
    if (!node || get().isDeletingToTrash) {
      return;
    }

    if (!isTauriRuntime()) {
      set({ pendingTrashNode: null });
      return;
    }

    set({ isDeletingToTrash: true });
    try {
      const freedBytes = await invokeDeleteItemToTrash(node.path);

      // Refresca el resumen y la vista actual desde el índice en memoria sin re-escanear
      const [updatedSummary, updatedChildren, updatedSectionFiles] = await Promise.all([
        fetchScanSummary(),
        get().currentFolderPath
          ? fetchFolderChildren(get().currentFolderPath)
          : Promise.resolve([]),
        fetchFilesBySection(get().selectedSection, 200),
      ]);

      set({
        pendingTrashNode: null,
        isDeletingToTrash: false,
        scanSummary: updatedSummary,
        currentFolderChildren: updatedChildren,
        sectionFiles: updatedSectionFiles,
      });

      // Actualiza también los indicadores del Dashboard y el registro de auditoría
      void get().loadSystemOverview(true);
      void useAppStore.getState().refreshAuditLogs(5);

      useAppStore.getState().addToast({
        title: 'Enviado a la Papelera de Reciclaje',
        message: `Se liberaron ${formatBytes(freedBytes)} al mover "${node.name}" a la Papelera.`,
        variant: 'success',
      });
    } catch (err) {
      set({ isDeletingToTrash: false, pendingTrashNode: null });
      useAppStore.getState().addToast({
        title: 'No se pudo enviar a la Papelera',
        message: extractError(err),
        variant: 'error',
        durationMs: 6500,
      });
    }
  },

  sendPathToNas: (path) => {
    set({ pendingNasSourcePath: path });
    useAppStore.getState().setActiveRoute('nas');
    useAppStore.getState().addToast({
      title: 'Ruta preparada para Mover al NAS',
      message: `Elemento seleccionado: ${path}`,
      variant: 'info',
      durationMs: 4000,
    });
  },

  clearPendingNasSourcePath: () => {
    set({ pendingNasSourcePath: null });
  },
}));
