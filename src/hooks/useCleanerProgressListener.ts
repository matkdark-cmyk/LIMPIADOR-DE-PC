import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useCleanerStore } from '../store/useCleanerStore';
import type { CacheCleanProgress, CacheScanProgress } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha globalmente `"cache-scan-progress"` y `"cache-clean-progress"` desde Rust
 * para conservar el progreso en vivo incluso al cambiar entre secciones.
 */
export function useCleanerProgressListener(): void {
  const setScanProgress = useCleanerStore((state) => state.setScanProgress);
  const setCleanProgress = useCleanerStore((state) => state.setCleanProgress);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isDisposed = false;
    let unlistenScan: (() => void) | null = null;
    let unlistenClean: (() => void) | null = null;

    void listen<CacheScanProgress>('cache-scan-progress', (event) => {
      if (!isDisposed) {
        setScanProgress(event.payload);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenScan = unlisten;
      }
    });

    void listen<CacheCleanProgress>('cache-clean-progress', (event) => {
      if (!isDisposed) {
        setCleanProgress(event.payload);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenClean = unlisten;
      }
    });

    return () => {
      isDisposed = true;
      if (unlistenScan) {
        unlistenScan();
      }
      if (unlistenClean) {
        unlistenClean();
      }
    };
  }, [setScanProgress, setCleanProgress]);
}
