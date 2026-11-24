import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  invokeCancelTransfer,
  invokeIsCriticalOperationRunning,
  isTauriRuntime,
} from '../utils/tauri';

interface WindowCloseGuardState {
  isGuardOpen: boolean;
  isCancellingAndClosing: boolean;
  dismissGuard: () => void;
  cancelTransferAndExit: () => Promise<void>;
}

/**
 * Intercepta el cierre de la ventana principal de Tauri v2.
 * Si existe una transferencia hacia el NAS o una reubicación de aplicación en curso,
 * detiene el cierre inmediato y muestra un modal de confirmación seguro.
 */
export function useWindowCloseGuard(): WindowCloseGuardState {
  const [isGuardOpen, setIsGuardOpen] = useState(false);
  const [isCancellingAndClosing, setIsCancellingAndClosing] = useState(false);
  const allowForceCloseRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    const appWindow = getCurrentWindow();

    void appWindow
      .onCloseRequested(async (event) => {
        if (allowForceCloseRef.current) {
          return;
        }

        try {
          const isCriticalRunning = await invokeIsCriticalOperationRunning();
          if (isCriticalRunning) {
            event.preventDefault();
            if (!disposed) {
              setIsGuardOpen(true);
            }
          }
        } catch {
          // Si falla la consulta IPC, no bloquear el cierre de la ventana
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      });

    return () => {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  const dismissGuard = useCallback(() => {
    if (isCancellingAndClosing) {
      return;
    }
    setIsGuardOpen(false);
  }, [isCancellingAndClosing]);

  const cancelTransferAndExit = useCallback(async () => {
    if (isCancellingAndClosing) {
      return;
    }
    setIsCancellingAndClosing(true);

    try {
      await invokeCancelTransfer();
    } catch {
      // Continuar con el cierre incluso si la transferencia ya finalizó
    }

    allowForceCloseRef.current = true;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.destroy();
    } catch {
      setIsCancellingAndClosing(false);
      setIsGuardOpen(false);
    }
  }, [isCancellingAndClosing]);

  return {
    isGuardOpen,
    isCancellingAndClosing,
    dismissGuard,
    cancelTransferAndExit,
  };
}
