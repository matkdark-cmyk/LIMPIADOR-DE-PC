import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface CloseGuardModalProps {
  open: boolean;
  isCancelling: boolean;
  onWait: () => void;
  onCancelAndExit: () => void;
}

export function CloseGuardModal({
  open,
  isCancelling,
  onWait,
  onCancelAndExit,
}: CloseGuardModalProps) {
  useEscapeKey(open, onWait, isCancelling);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-guard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onWait}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="close-guard-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Transferencia segura en curso
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Hay una transferencia segura hacia el NAS en curso. Si cierras ahora se cancelará el
              proceso (tus archivos locales seguirán intactos). ¿Deseas esperar o cancelar y salir?
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Ningún archivo local se borra hasta confirmar integridad xxHash3 al 100%.</span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isCancelling}
            onClick={onCancelAndExit}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950"
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cancelando y saliendo...
              </>
            ) : (
              'Cancelar y salir'
            )}
          </button>

          <button
            type="button"
            disabled={isCancelling}
            onClick={onWait}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            Esperar a que termine
          </button>
        </div>
      </div>
    </div>
  );
}
