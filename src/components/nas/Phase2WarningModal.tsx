import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, ShieldOff, XCircle } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useNasStore } from '../../store/useNasStore';

export function Phase2WarningModal() {
  const pendingPhase2Warning = useNasStore((state) => state.pendingPhase2Warning);
  const isFinalizingPhase2Skip = useNasStore((state) => state.isFinalizingPhase2Skip);
  const stopTransferAfterPhase2Warning = useNasStore(
    (state) => state.stopTransferAfterPhase2Warning,
  );
  const ignorePhase2WarningAndContinue = useNasStore(
    (state) => state.ignorePhase2WarningAndContinue,
  );

  const [acceptedRisk, setAcceptedRisk] = useState(false);

  const isOpen = pendingPhase2Warning !== null;

  useEffect(() => {
    setAcceptedRisk(false);
  }, [pendingPhase2Warning]);

  useEscapeKey(isOpen && !isFinalizingPhase2Skip, stopTransferAfterPhase2Warning);

  if (!pendingPhase2Warning) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phase2-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-2xl dark:border-amber-700/80 dark:bg-slate-900">
        {/* Cabecera */}
        <div className="flex items-start gap-3.5 border-b border-amber-200 bg-amber-50/90 px-6 py-5 dark:border-amber-900/70 dark:bg-amber-950/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="phase2-warning-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Advertencia en el Paso 2 (Verificación automática xxHash3)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              La copia al disco de respaldo o NAS se detuvo en el <strong>Paso 2 (xxHash3)</strong>{' '}
              antes de tocar tu carpeta original. Decide si deseas ignorar esta advertencia y seguir
              con el proceso o dejarlo hasta aquí.
            </p>
          </div>
        </div>

        {/* Detalle de la advertencia */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>Detalle detectado en el Paso 2 (xxHash3)</span>
            </div>
            <p className="mt-2 leading-relaxed text-slate-700 dark:text-slate-200">
              {pendingPhase2Warning}
            </p>
          </div>

          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Tu carpeta original local permanece <strong>100% intacta</strong>. Si aceptas esta
            advertencia, el proceso se detiene aquí mismo sin continuar. Si eliges ignorarla, se
            omitirá el Paso 2 (xxHash3) y se completará el proceso con los archivos ya copiados.
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            <input
              type="checkbox"
              disabled={isFinalizingPhase2Skip}
              checked={acceptedRisk}
              onChange={(e) => setAcceptedRisk(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="leading-relaxed">
              <strong>Entiendo la advertencia y deseo continuar:</strong> autorizo ignorar la
              advertencia del Paso 2 (xxHash3) y continuar con el cierre del proceso bajo mi
              responsabilidad.
            </span>
          </label>
        </div>

        {/* Botones de decisión */}
        <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            disabled={!acceptedRisk || isFinalizingPhase2Skip}
            onClick={() => void ignorePhase2WarningAndContinue()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
          >
            {isFinalizingPhase2Skip ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Completando proceso...</span>
              </>
            ) : (
              <>
                <ShieldOff className="h-4 w-4" />
                <span>Ignorar advertencia y seguir con el proceso</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isFinalizingPhase2Skip}
            onClick={stopTransferAfterPhase2Warning}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <XCircle className="h-4 w-4" />
            <span>Aceptar advertencia y dejar hasta aquí</span>
          </button>
        </div>
      </div>
    </div>
  );
}
