import {
  AlertTriangle,
  ArrowRight,
  Download,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import { formatBytes, formatDateTime } from '../../utils/format';

export function UpdateDetailsModal() {
  const updateInfo = useUpdaterStore((s) => s.updateInfo);
  const isModalOpen = useUpdaterStore((s) => s.isModalOpen);
  const isInstalling = useUpdaterStore((s) => s.isInstalling);
  const progress = useUpdaterStore((s) => s.progress);
  const error = useUpdaterStore((s) => s.error);
  const cancelAndCloseModal = useUpdaterStore((s) => s.cancelAndCloseModal);
  const confirmAndInstallUpdate = useUpdaterStore((s) => s.confirmAndInstallUpdate);

  useEscapeKey(isModalOpen, cancelAndCloseModal, isInstalling);

  if (!isModalOpen || !updateInfo || !updateInfo.updateAvailable) {
    return null;
  }

  const releaseLines = updateInfo.releaseNotes
    .split(/\r?\n/)
    .map((l) => l.trimEnd());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-details-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={() => !isInstalling && cancelAndCloseModal()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-6 py-5 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="update-details-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Nueva actualización disponible
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {updateInfo.releaseTitle}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  v{updateInfo.currentVersion}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="rounded-md bg-blue-600 px-2 py-0.5 font-semibold text-white">
                  v{updateInfo.latestVersion}
                </span>
                {updateInfo.publishedAt && (
                  <span className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                    · Publicada el {formatDateTime(updateInfo.publishedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!isInstalling && (
            <button
              type="button"
              onClick={cancelAndCloseModal}
              aria-label="Cerrar ventana de actualización"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Contenido scrollable: Detalle de mejoras + Metadatos */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Detalle de la actualización y novedades
            </p>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
              {releaseLines.map((line, index) => {
                if (!line.trim()) {
                  return <div key={index} className="h-2" />;
                }
                const cleanedHeading = line.replace(/^#{1,6}\s+/, '');
                if (/^#{1,6}\s+/.test(line)) {
                  return (
                    <p
                      key={index}
                      className="mt-2 mb-1 text-xs font-semibold text-slate-900 first:mt-0 dark:text-slate-100"
                    >
                      {cleanedHeading}
                    </p>
                  );
                }
                return (
                  <p key={index} className="whitespace-pre-wrap">
                    {line}
                  </p>
                );
              })}
            </div>
          </div>

          {/* Ficha de paquete y seguridad */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-start gap-2.5">
              <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  {updateInfo.isPortablePackage
                    ? 'Actualización Portable (.zip)'
                    : 'Actualización Instalador (.exe)'}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {updateInfo.assetName ?? 'Paquete oficial'} ·{' '}
                  {updateInfo.assetSizeBytes > 0
                    ? formatBytes(updateInfo.assetSizeBytes)
                    : 'Tamaño variable'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  Reinicio automático seguro
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {updateInfo.checksumsUrl
                    ? 'Verifica firma SHA-256 oficial antes de instalar y abre la nueva ventana sola.'
                    : 'Descarga directa por HTTPS desde GitHub y relanza la ventana nueva.'}
                </p>
              </div>
            </div>
          </div>

          {updateInfo.isPortablePackage && (
            <p className="rounded-lg border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
              Tu carpeta <span className="font-mono font-semibold">.\data\</span> (base de datos
              SQLite, destinos NAS y ajustes) y <span className="font-mono">portable.flag</span> se
              conservarán intactos durante la actualización.
            </p>
          )}

          {/* Barra de progreso durante descarga / verificación / reinicio */}
          {isInstalling && progress && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-800/70 dark:bg-blue-950/40">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-blue-900 dark:text-blue-200">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  {progress.message}
                </span>
                <span className="font-mono tabular-nums">
                  {progress.totalBytes > 0 ? `${Math.round(progress.percent)}%` : '...'}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200/80 dark:bg-blue-900/60">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-150 dark:bg-blue-400"
                  style={{
                    width: `${progress.stage === 'installing' || progress.stage === 'verifying' ? 100 : Math.max(4, progress.percent)}%`,
                  }}
                />
              </div>
              {progress.downloadedBytes > 0 && progress.totalBytes > 0 && (
                <p className="font-mono text-[11px] tabular-nums text-blue-800/80 dark:text-blue-300/80">
                  {formatBytes(progress.downloadedBytes)} de {formatBytes(progress.totalBytes)}
                </p>
              )}
            </div>
          )}

          {/* Error recuperable */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Pie de acciones: Confirmación explícita */}
        <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/50">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Si cancelas ahora, no se descargará ni modificará ningún archivo.
          </p>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isInstalling}
              onClick={cancelAndCloseModal}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              No actualizar (Detener)
            </button>
            <button
              type="button"
              disabled={isInstalling}
              onClick={() => void confirmAndInstallUpdate()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {isInstalling ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Actualizando y reiniciando...</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span>Aceptar e instalar actualización</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
