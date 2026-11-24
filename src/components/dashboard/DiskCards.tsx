import {
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Search,
  TerminalSquare,
  Usb,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useScannerStore } from '../../store/useScannerStore';
import type { DiskAlertLevel, DiskInfo } from '../../types';
import { formatBytes, formatPercent } from '../../utils/format';

function getBarColor(level: DiskAlertLevel): string {
  switch (level) {
    case 'critical':
      return 'bg-red-600 dark:bg-red-500';
    case 'warning':
      return 'bg-amber-500 dark:bg-amber-400';
    case 'normal':
      return 'bg-blue-600 dark:bg-blue-500';
  }
}

function getPercentTextColor(level: DiskAlertLevel): string {
  switch (level) {
    case 'critical':
      return 'text-red-700 dark:text-red-400';
    case 'warning':
      return 'text-amber-700 dark:text-amber-300';
    case 'normal':
      return 'text-slate-900 dark:text-slate-100';
  }
}

function DiskCard({ disk }: { disk: DiskInfo }) {
  const analyzeDriveFromDashboard = useScannerStore(
    (state) => state.analyzeDriveFromDashboard,
  );
  const isScanning = useScannerStore((state) => state.isScanning);

  const clampedPercent = Math.min(100, Math.max(0, disk.usagePercent));

  return (
    <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        {/* Encabezado de unidad */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {disk.isRemovable ? (
                <Usb className="h-5 w-5" />
              ) : (
                <HardDrive className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {disk.name} ({disk.mountPoint.replace(/\\+$/, '')})
                </h3>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{disk.diskKind}</span>
                <span aria-hidden="true">·</span>
                <span>{disk.fileSystem}</span>
                {disk.isRemovable && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Extraíble</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <span
            className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${getPercentTextColor(disk.alertLevel)}`}
          >
            {formatPercent(disk.usagePercent)}
          </span>
        </div>

        {/* Barra de ocupación con semáforo */}
        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${getBarColor(disk.alertLevel)}`}
              style={{ width: `${clampedPercent}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-mono tabular-nums">
              {formatBytes(disk.usedBytes)} usados de {formatBytes(disk.totalBytes)}
            </span>
            <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-200">
              {formatBytes(disk.availableBytes)} libres
            </span>
          </div>
        </div>

        {/* Aviso humano si queda poco espacio */}
        {disk.alertLevel !== 'normal' && (
          <div
            className={`mt-3 flex items-center gap-2 text-xs font-medium ${
              disk.alertLevel === 'critical'
                ? 'text-red-700 dark:text-red-400'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {disk.alertLevel === 'critical'
                ? 'Queda muy poco espacio libre. Conviene liberar archivos o mover carpetas al NAS.'
                : 'Queda poco espacio libre en esta unidad.'}
            </span>
          </div>
        )}
      </div>

      {/* Acción directa */}
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          disabled={isScanning}
          onClick={() => void analyzeDriveFromDashboard(disk.mountPoint)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span>{isScanning ? 'Escaneo en curso...' : 'Analizar este disco'}</span>
        </button>
      </div>
    </article>
  );
}

export function DiskCards() {
  const isTauri = useAppStore((state) => state.isTauri);
  const systemOverview = useScannerStore((state) => state.systemOverview);
  const isLoadingOverview = useScannerStore((state) => state.isLoadingOverview);
  const overviewError = useScannerStore((state) => state.overviewError);
  const loadSystemOverview = useScannerStore((state) => state.loadSystemOverview);

  return (
    <section aria-label="Unidades de almacenamiento" className="space-y-3.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Estado de tus discos
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Espacio ocupado y disponible en cada unidad conectada a tu equipo.
          </p>
        </div>

        {isTauri && (
          <button
            type="button"
            disabled={isLoadingOverview}
            onClick={() => void loadSystemOverview(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOverview ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        )}
      </div>

      {!isTauri ? (
        <div className="flex items-start gap-3.5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Lectura de discos reales disponible en Windows
            </h3>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Ejecuta{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                npm run tauri dev
              </code>{' '}
              en tu PC Windows para listar tus unidades reales (<span className="font-mono">C:\</span>,{' '}
              <span className="font-mono">D:\</span>, etc.) mediante <span className="font-mono">sysinfo</span> y
              escanearlas en segundos con el motor multi-hilo en Rust.
            </p>
          </div>
        </div>
      ) : isLoadingOverview && !systemOverview ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2].map((idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
                </div>
              </div>
              <div className="mt-5 h-2.5 w-full animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="mt-5 h-9 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
            </div>
          ))}
        </div>
      ) : overviewError ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/60 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Error al consultar las unidades del sistema
              </p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{overviewError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadSystemOverview(false)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Reintentar
          </button>
        </div>
      ) : systemOverview && systemOverview.disks.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {systemOverview.disks.map((disk) => (
            <DiskCard key={disk.mountPoint} disk={disk} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No se detectaron unidades montadas.
          </p>
        </div>
      )}
    </section>
  );
}
