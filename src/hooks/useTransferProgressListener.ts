import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useNasStore } from '../store/useNasStore';
import type { TransferProgress } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha globalmente `"transfer-progress"` desde Rust (~150ms) para conservar
 * el progreso en vivo del migrador incluso al cambiar entre secciones de la app.
 */
export function useTransferProgressListener(): void {
  const setTransferProgress = useNasStore((state) => state.setTransferProgress);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isDisposed = false;
    let unlistenFn: (() => void) | null = null;

    void listen<TransferProgress>('transfer-progress', (event) => {
      if (!isDisposed) {
        setTransferProgress(event.payload);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    });

    return () => {
      isDisposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [setTransferProgress]);
}
