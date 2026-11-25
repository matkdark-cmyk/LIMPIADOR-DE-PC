import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { useUpdaterStore } from '../store/useUpdaterStore';
import type { UpdateProgressEvent } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha eventos de progreso de actualización desde Rust (`"update-progress"`)
 * y realiza una comprobación silenciosa al iniciar la app para mostrar la ventana
 * de detalles solo si existe una nueva versión publicada en GitHub Releases.
 */
export function useUpdateListener(): void {
  const setProgress = useUpdaterStore((s) => s.setProgress);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const hasCheckedOnBoot = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    void listen<UpdateProgressEvent>('update-progress', (event) => {
      if (!disposed) {
        setProgress(event.payload);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    let bootTimer: number | null = null;
    if (!hasCheckedOnBoot.current) {
      hasCheckedOnBoot.current = true;
      bootTimer = window.setTimeout(() => {
        if (!disposed) {
          void checkForUpdates({ silent: true, openModalIfAvailable: true });
        }
      }, 3000);
    }

    return () => {
      disposed = true;
      if (bootTimer !== null) {
        window.clearTimeout(bootTimer);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [setProgress, checkForUpdates]);
}
