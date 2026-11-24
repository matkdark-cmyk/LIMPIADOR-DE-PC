import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppsStore } from '../store/useAppsStore';
import type { AppMetadataUpdate, AppsScanComplete } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha globalmente los eventos incrementales del inventario de aplicaciones:
 * - `"apps-metadata-update"`: lotes con peso real en disco, última fecha de uso e ícono base64.
 * - `"apps-scan-complete"`: señal de finalización del cálculo en segundo plano.
 */
export function useAppsMetadataListener(): void {
  const applyMetadataBatch = useAppsStore((state) => state.applyMetadataBatch);
  const markEnrichmentComplete = useAppsStore((state) => state.markEnrichmentComplete);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isDisposed = false;
    let unlistenUpdates: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    void listen<AppMetadataUpdate[]>('apps-metadata-update', (event) => {
      if (!isDisposed && Array.isArray(event.payload)) {
        applyMetadataBatch(event.payload);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenUpdates = unlisten;
      }
    });

    void listen<AppsScanComplete>('apps-scan-complete', (event) => {
      if (!isDisposed) {
        markEnrichmentComplete(event.payload.totalProcessed);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenComplete = unlisten;
      }
    });

    return () => {
      isDisposed = true;
      if (unlistenUpdates) {
        unlistenUpdates();
      }
      if (unlistenComplete) {
        unlistenComplete();
      }
    };
  }, [applyMetadataBatch, markEnrichmentComplete]);
}
