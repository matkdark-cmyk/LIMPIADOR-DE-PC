import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../store/useAppStore';
import { useRamStore } from '../store/useRamStore';
import type { RamAutoOptimizedEvent } from '../types';
import { formatBytes } from '../utils/format';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha globalmente el evento `"ram-auto-optimized"` emitido por el worker en Rust
 * y muestra una notificación discreta cuando se libera memoria automáticamente.
 */
export function useRamAutoEventListener(): void {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isDisposed = false;
    let unlistenFn: (() => void) | null = null;

    void listen<RamAutoOptimizedEvent>('ram-auto-optimized', (event) => {
      if (isDisposed) {
        return;
      }
      const payload = event.payload;
      const totalFreed = payload.freedBytes + payload.standbyFreedBytes;
      const beforePct = Math.round(payload.beforePercent);
      const afterPct = Math.round(payload.afterPercent);

      useAppStore.getState().addToast({
        title: 'RAM optimizada automáticamente',
        message:
          totalFreed > 0
            ? `Se liberaron ${formatBytes(totalFreed)} en segundo plano (uso bajó de ${beforePct}% a ${afterPct}%).`
            : `Revisión automática completada (${beforePct}% → ${afterPct}%).`,
        variant: 'info',
        durationMs: 6000,
      });

      void useAppStore.getState().refreshAuditLogs(10);

      if (useAppStore.getState().activeRoute === 'ram') {
        void useRamStore.getState().fetchSnapshot({ silent: true });
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
  }, []);
}
