import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { CacheTarget } from '../../types';
import { formatBytes, formatNumber } from '../../utils/format';

interface CleanConfirmModalProps {
  open: boolean;
  selectedTargets: CacheTarget[];
  useRecycleBin: boolean;
  onClose: () => void;
  onConfirm: (closeRunningApps: boolean) => void;
}

export function CleanConfirmModal({
  open,
  selectedTargets,
  useRecycleBin,
  onClose,
  onConfirm,
}: CleanConfirmModalProps) {
  const [closeRunningApps, setCloseRunningApps] = useState(false);

  useEscapeKey(open, onClose);

  useEffect(() => {
    if (open) {
      setCloseRunningApps(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const totalBytes = selectedTargets.reduce((sum, t) => sum + t.sizeBytes, 0);
  const totalFiles = selectedTargets.reduce((sum, t) => sum + t.fileCount, 0);
  const recycleBinTarget = selectedTargets.find((t) => t.group === 'recycle_bin');
  const otherReviewTargets = selectedTargets.filter(
    (t) => t.safety === 'review' && t.group !== 'recycle_bin',
  );
  const runningTargets = selectedTargets.filter((t) => t.isLockedByRunningApp);
  const includesWindowsUpdate = selectedTargets.some((t) => t.serviceToPause === 'wuauserv');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clean-confirm-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              Confirmar limpieza de caché
            </p>
            <h3
              id="clean-confirm-title"
              className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              ¿Limpiar {formatBytes(totalBytes)} seleccionados?
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 px-6 py-5">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <span className="text-slate-600 dark:text-slate-400">
              Categorías:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {selectedTargets.length}
              </strong>{' '}
              · Modo:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {useRecycleBin ? 'Papelera (respaldo)' : 'Liberación directa'}
              </strong>
            </span>
            <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(totalFiles)} archivos
            </span>
          </div>

          {recycleBinTarget && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-semibold">
                  Vaciarás la Papelera de Reciclaje ({formatBytes(recycleBinTarget.sizeBytes)})
                </p>
                <p className="mt-0.5 opacity-90">
                  Los archivos que ya estaban en la Papelera se eliminarán de forma permanente y no
                  podrán restaurarse.
                </p>
              </div>
            </div>
          )}

          {otherReviewTargets.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="font-semibold">
                  Incluiste {otherReviewTargets.length} categoría(s) marcadas como «Revisar»:
                </p>
                <ul className="list-disc pl-4 opacity-90">
                  {otherReviewTargets.map((t) => (
                    <li key={t.id}>
                      {t.name} ({formatBytes(t.sizeBytes)})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {runningTargets.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">
                Hay programas abiertos en tu selección (
                {runningTargets.map((t) => t.name.replace('Caché de ', '')).join(', ')}).
              </p>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={closeRunningApps}
                  onChange={(e) => setCloseRunningApps(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                Cerrar automáticamente antes de limpiar (si no la marcas, los archivos en uso se
                omitirán sin error).
              </label>
            </div>
          )}

          {includesWindowsUpdate && (
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <span>
                <strong>Windows Update (wuauserv)</strong> se pausará unos segundos para limpiar sus
                descargas y se volverá a iniciar automáticamente al finalizar.
              </span>
            </div>
          )}

          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Tus documentos personales, fotos, contraseñas, sesiones de navegador y archivos
            protegidos de Windows nunca se modifican.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50/60 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(closeRunningApps)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Limpiar ahora
          </button>
        </div>
      </div>
    </div>
  );
}
