import { create } from 'zustand';
import type { UpdateCheckResult, UpdateProgressEvent } from '../types';
import {
  invokeCheckForUpdates,
  invokeDownloadAndInstallUpdate,
  isTauriRuntime,
} from '../utils/tauri';
import { useAppStore } from './useAppStore';

function extractError(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'No se pudo completar la operación de actualización.';
}

interface CheckUpdateOptions {
  silent?: boolean;
  openModalIfAvailable?: boolean;
}

interface UpdaterStoreState {
  updateInfo: UpdateCheckResult | null;
  isChecking: boolean;
  isModalOpen: boolean;
  isInstalling: boolean;
  progress: UpdateProgressEvent | null;
  error: string | null;
  lastCheckedAt: string | null;

  checkForUpdates: (options?: CheckUpdateOptions) => Promise<UpdateCheckResult | null>;
  openUpdateModal: () => void;
  cancelAndCloseModal: () => void;
  confirmAndInstallUpdate: () => Promise<void>;
  setProgress: (event: UpdateProgressEvent) => void;
}

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => ({
  updateInfo: null,
  isChecking: false,
  isModalOpen: false,
  isInstalling: false,
  progress: null,
  error: null,
  lastCheckedAt: null,

  checkForUpdates: async (options = {}) => {
    const { silent = false, openModalIfAvailable = true } = options;

    if (!isTauriRuntime()) {
      if (!silent) {
        useAppStore.getState().addToast({
          title: 'Actualizaciones disponibles en Windows',
          message:
            'Ejecuta DiskVault Clean en tu PC Windows para buscar e instalar nuevas versiones desde GitHub.',
          variant: 'info',
        });
      }
      return null;
    }

    if (get().isChecking || get().isInstalling) {
      return get().updateInfo;
    }

    set({ isChecking: true, error: null });
    try {
      const result = await invokeCheckForUpdates();
      set({
        updateInfo: result,
        isChecking: false,
        lastCheckedAt: new Date().toISOString(),
        isModalOpen: result.updateAvailable && openModalIfAvailable ? true : get().isModalOpen,
      });

      if (!silent && !result.updateAvailable) {
        useAppStore.getState().addToast({
          title: 'DiskVault Clean está actualizado',
          message: `Ya tienes la última versión disponible (v${result.currentVersion}).`,
          variant: 'success',
        });
      }

      return result;
    } catch (err) {
      const msg = extractError(err);
      set({ isChecking: false, error: msg });
      if (!silent) {
        useAppStore.getState().addToast({
          title: 'No se pudieron comprobar actualizaciones',
          message: msg,
          variant: 'warning',
        });
      }
      return null;
    }
  },

  openUpdateModal: () => {
    const info = get().updateInfo;
    if (info && info.updateAvailable) {
      set({ isModalOpen: true, error: null });
    }
  },

  cancelAndCloseModal: () => {
    if (get().isInstalling) {
      return;
    }
    set({ isModalOpen: false, progress: null, error: null });
    useAppStore.getState().addToast({
      title: 'Actualización detenida',
      message:
        'No se descargó ni instaló nada. Puedes actualizar cuando quieras desde el encabezado o en Ajustes.',
      variant: 'info',
    });
  },

  confirmAndInstallUpdate: async () => {
    const { updateInfo, isInstalling } = get();
    if (isInstalling || !updateInfo || !updateInfo.updateAvailable) {
      return;
    }
    if (!updateInfo.downloadUrl || !updateInfo.assetName) {
      set({
        error:
          'Este Release no contiene un paquete compatible para tu modo de ejecución actual.',
      });
      return;
    }

    set({
      isInstalling: true,
      error: null,
      progress: {
        stage: 'downloading',
        downloadedBytes: 0,
        totalBytes: updateInfo.assetSizeBytes,
        percent: 0,
        message: `Iniciando descarga de v${updateInfo.latestVersion}...`,
      },
    });

    try {
      await invokeDownloadAndInstallUpdate({
        version: updateInfo.latestVersion,
        downloadUrl: updateInfo.downloadUrl,
        assetName: updateInfo.assetName,
        checksumsUrl: updateInfo.checksumsUrl,
        isPortablePackage: updateInfo.isPortablePackage,
      });
      // Si la actualización tuvo éxito en Windows, el backend cierra la instancia actual
      // y relanza la nueva ventana automáticamente.
    } catch (err) {
      const msg = extractError(err);
      set({
        isInstalling: false,
        progress: null,
        error: msg,
      });
      useAppStore.getState().addToast({
        title: 'No se pudo completar la actualización',
        message: msg,
        variant: 'error',
        durationMs: 7500,
      });
    }
  },

  setProgress: (event) => {
    set({ progress: event });
  },
}));
