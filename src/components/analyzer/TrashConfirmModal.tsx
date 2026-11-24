import { Loader2, Trash2, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useScannerStore } from '../../store/useScannerStore';
import { formatBytes } from '../../utils/format';

export function TrashConfirmModal() {
  const pendingTrashNode = useScannerStore((state) => state.pendingTrashNode);
  const isDeletingToTrash = useScannerStore((state) => state.isDeletingToTrash);
  const cancelTrashDelete = useScannerStore((state) => state.cancelTrashDelete);
  const confirmTrashDelete = useScannerStore((state) => state.confirmTrashDelete);

  useEscapeKey(Boolean(pendingTrashNode), cancelTrashDelete, isDeletingToTrash);

  if (!pendingTrashNode) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trash-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
      onClick={cancelTrashDelete}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="trash-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                ¿Enviar a la Papelera de Reciclaje?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Este elemento no se destruirá de forma permanente: se moverá de forma segura a la
                Papelera de Reciclaje de Windows por si necesitas restaurarlo después.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isDeletingToTrash}
            onClick={cancelTrashDelete}
            aria-label="Cerrar ventana"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-slate-500 dark:text-slate-400">Elemento</span>
            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {pendingTrashNode.name}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-slate-500 dark:text-slate-400">Tipo y peso</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {pendingTrashNode.isDir ? 'Carpeta' : 'Archivo'} · {formatBytes(pendingTrashNode.sizeBytes)}
            </span>
          </div>
          <div className="border-t border-slate-200/80 pt-2 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Ubicación original
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {pendingTrashNode.path}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isDeletingToTrash}
            onClick={cancelTrashDelete}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isDeletingToTrash}
            onClick={() => void confirmTrashDelete()}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 whitespace-nowrap dark:bg-red-500 dark:hover:bg-red-400"
          >
            {isDeletingToTrash ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{isDeletingToTrash ? 'Enviando...' : 'Enviar a Papelera'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
