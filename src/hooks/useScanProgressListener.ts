import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useScannerStore } from '../store/useScannerStore';
import type { ScanProgress } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha globalmente el evento `"scan-progress"` emitido desde Rust (~150ms)
 * para mantener el progreso fluido incluso si el usuario cambia de pestaña.
 */
export function useScanProgressListener(): void {
  const setScanProgress = useScannerStore((state) => state.setScanProgress);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isDisposed = false;
    let unlistenFn: (() => void) | null = null;

    void listen<ScanProgress>('scan-progress', (event) => {
      if (!isDisposed) {
        setScanProgress(event.payload);
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
  }, [setScanProgress]);
}
