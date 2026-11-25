import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useNasStore } from '../store/useNasStore';
import type { IncomingFileActionEvent, IncomingFileEvent } from '../types';
import { isTauriRuntime } from '../utils/tauri';

/**
 * Escucha eventos del detector automático de archivos descargados o copiados
 * (`"incoming-file-detected"` y `"incoming-file-action"`) enviados desde Rust
 * cuando el usuario recibe o hace clic en una notificación nativa de Windows.
 */
export function useIncomingFileListener(): void {
  const registerIncomingFile = useNasStore((s) => s.registerIncomingFile);
  const openIncomingFileModal = useNasStore((s) => s.openIncomingFileModal);
  const keepIncomingFileOnPc = useNasStore((s) => s.keepIncomingFileOnPc);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlistenDetected: UnlistenFn | null = null;
    let unlistenAction: UnlistenFn | null = null;

    void listen<IncomingFileEvent>('incoming-file-detected', (event) => {
      if (!disposed) {
        registerIncomingFile(event.payload);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenDetected = fn;
      }
    });

    void listen<IncomingFileActionEvent>('incoming-file-action', (event) => {
      if (disposed) {
        return;
      }
      if (event.payload.action === 'keep_pc') {
        void keepIncomingFileOnPc(event.payload.id, true);
      } else {
        void openIncomingFileModal(event.payload.id);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenAction = fn;
      }
    });

    return () => {
      disposed = true;
      if (unlistenDetected) {
        unlistenDetected();
      }
      if (unlistenAction) {
        unlistenAction();
      }
    };
  }, [registerIncomingFile, openIncomingFileModal, keepIncomingFileOnPc]);
}
