import { FolderSync, Play, ShieldCheck, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useNasStore } from '../../store/useNasStore';

const MODE_LABELS: Record<string, string> = {
  archive_free: 'Archivar y liberar espacio',
  move_symlink: 'Mover con enlace transparente',
  copy_backup: 'Solo respaldar (copia segura)',
};

export function ScanPromptModal() {
  const isScanPromptOpen = useNasStore((state) => state.isScanPromptOpen);
  const sourcePath = useNasStore((state) => state.sourcePath);
  const destRoot = useNasStore((state) => state.destRoot);
  const mode = useNasStore((state) => state.mode);
  const closeScanPrompt = useNasStore((state) => state.closeScanPrompt);
  const confirmTransferWithVirusScan = useNasStore(
    (state) => state.confirmTransferWithVirusScan,
  );
  const confirmTransferWithoutVirusScan = useNasStore(
    (state) => state.confirmTransferWithoutVirusScan,
  );

  useEscapeKey(isScanPromptOpen, closeScanPrompt);

  if (!isScanPromptOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-prompt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white dark:bg-blue-500">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="scan-prompt-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                ¿Deseas escanear en busca de virus antes de copiar?
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Elige si quieres analizar los archivos seleccionados antes de transferirlos al disco
                de respaldo o al NAS.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeScanPrompt}
            aria-label="Cerrar diálogo"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resumen de la operación */}
        <div className="space-y-4 px-6 py-5">
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-slate-500 dark:text-slate-400">Origen:</span>
              <span className="truncate font-mono font-medium text-slate-800 dark:text-slate-200" title={sourcePath}>
                {sourcePath}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-slate-500 dark:text-slate-400">Destino:</span>
              <span className="truncate font-mono font-medium text-slate-800 dark:text-slate-200" title={destRoot}>
                {destRoot}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-slate-500 dark:text-slate-400">Modo:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {MODE_LABELS[mode] ?? mode}
              </span>
            </div>
          </div>

          {/* Explicación de ambas opciones */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3.5 text-xs dark:border-blue-500/30 dark:bg-blue-500/10">
              <p className="font-semibold text-blue-900 dark:text-blue-200">
                Sí, escanear primero
              </p>
              <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-300">
                Analiza con Windows Defender y reglas heurísticas antes de copiar. Si detecta algo
                sospechoso, te mostrará la ruta exacta para decidir.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                No escanear, copiar todo
              </p>
              <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-300">
                Omite el análisis antivirus y copia de inmediato todo el contenido seleccionado al
                disco de respaldo o al NAS, manteniendo verificación xxHash3.
              </p>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={closeScanPrompt}
            className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Cancelar
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void confirmTransferWithoutVirusScan()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <FolderSync className="h-3.5 w-3.5 shrink-0" />
              <span>No escanear, copiar todo</span>
            </button>

            <button
              type="button"
              onClick={() => void confirmTransferWithVirusScan()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span>Sí, escanear antes de copiar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
