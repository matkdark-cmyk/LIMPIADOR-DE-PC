import {
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  Shield,
  Square,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useScannerStore } from '../../store/useScannerStore';
import type { AnalyzerTab } from '../../types';
import { formatBytes, formatDuration, formatNumber } from '../../utils/format';
import { CategoryCards } from './CategoryCards';
import { DiskTreemap } from './DiskTreemap';
import { SizeTreeTable } from './SizeTreeTable';
import { TopFilesList } from './TopFilesList';
import { TrashConfirmModal } from './TrashConfirmModal';

const EXPLORER_TABS: { id: AnalyzerTab; label: string }[] = [
  { id: 'tree', label: 'Carpetas y Archivos (Mayor a Menor)' },
  { id: 'top-files', label: 'Top Archivos Más Pesados' },
  { id: 'sections', label: 'Por Secciones' },
];

export function AnalyzerView() {
  const appStatus = useAppStore((state) => state.appStatus);
  const requestAdminElevation = useAppStore((state) => state.requestAdminElevation);
  const isElevating = useAppStore((state) => state.isElevating);

  const systemOverview = useScannerStore((state) => state.systemOverview);
  const selectedRootPath = useScannerStore((state) => state.selectedRootPath);
  const setSelectedRootPath = useScannerStore((state) => state.setSelectedRootPath);
  const chooseFolderFromDialog = useScannerStore((state) => state.chooseFolderFromDialog);
  const isScanning = useScannerStore((state) => state.isScanning);
  const scanProgress = useScannerStore((state) => state.scanProgress);
  const scanSummary = useScannerStore((state) => state.scanSummary);
  const startScan = useScannerStore((state) => state.startScan);
  const cancelScan = useScannerStore((state) => state.cancelScan);
  const activeTab = useScannerStore((state) => state.activeTab);
  const setActiveTab = useScannerStore((state) => state.setActiveTab);

  const disks = systemOverview?.disks ?? [];
  const isAdmin = appStatus?.isAdmin ?? false;
  const isCustomPath =
    disks.length > 0 &&
    !disks.some(
      (d) => d.mountPoint.toLowerCase() === selectedRootPath.toLowerCase(),
    );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Barra de control superior */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            {/* Selector de unidad o ruta */}
            <div className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-md">
              <label htmlFor="scan-drive-select" className="sr-only">
                Seleccionar unidad o ruta a analizar
              </label>
              {disks.length > 0 ? (
                <select
                  id="scan-drive-select"
                  disabled={isScanning}
                  value={isCustomPath ? '__custom__' : selectedRootPath}
                  onChange={(event) => {
                    if (event.target.value !== '__custom__') {
                      setSelectedRootPath(event.target.value);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {disks.map((disk) => (
                    <option key={disk.mountPoint} value={disk.mountPoint}>
                      {disk.name} ({disk.mountPoint.replace(/\\+$/, '')}) —{' '}
                      {formatBytes(disk.usedBytes)} usados
                    </option>
                  ))}
                  {isCustomPath && (
                    <option value="__custom__">
                      Carpeta: {selectedRootPath}
                    </option>
                  )}
                </select>
              ) : (
                <input
                  id="scan-drive-select"
                  type="text"
                  disabled={isScanning}
                  value={selectedRootPath}
                  onChange={(event) => setSelectedRootPath(event.target.value)}
                  placeholder="Ej. C:\ o D:\Videos"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              )}
            </div>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => void chooseFolderFromDialog()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span>Elegir carpeta...</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {isScanning ? (
              <button
                type="button"
                onClick={() => void cancelScan()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 whitespace-nowrap shrink-0 dark:bg-red-500 dark:hover:bg-red-400"
              >
                <Square className="h-3.5 w-3.5 fill-current shrink-0" />
                <span>Cancelar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startScan()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                <Play className="h-3.5 w-3.5 fill-current shrink-0" />
                <span>Escanear</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra de progreso en vivo durante el escaneo */}
        {isScanning && scanProgress && (
          <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-blue-700 dark:text-blue-300">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>Escaneando disco en paralelo...</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                <span>{formatNumber(scanProgress.filesScanned)} archivos</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatBytes(scanProgress.bytesScanned)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(scanProgress.elapsedMs)}</span>
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-blue-600 dark:bg-blue-500" />
            </div>

            <p
              className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
              title={scanProgress.currentPath}
            >
              {scanProgress.currentPath}
            </p>
          </div>
        )}

        {/* Resumen rápido tras completar escaneo */}
        {!isScanning && scanSummary && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span>Último análisis:</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                {scanSummary.rootPath}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatBytes(scanSummary.totalBytes)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {formatNumber(scanSummary.totalFiles)} archivos en{' '}
                {formatNumber(scanSummary.totalDirs)} carpetas
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatDuration(scanSummary.durationMs)}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Aviso discreto si hubo carpetas omitidas por falta de permisos UAC */}
      {!isScanning && scanSummary && scanSummary.skippedAccessDenied > 0 && !isAdmin && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-200">
              Se omitieron{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatNumber(scanSummary.skippedAccessDenied)}
              </span>{' '}
              elementos protegidos por permisos de Windows. Si deseas un análisis más profundo de
              carpetas del sistema, activa el Modo Administrador.
            </p>
          </div>
          <button
            type="button"
            disabled={isElevating}
            onClick={() => void requestAdminElevation()}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            Activar Modo Administrador
          </button>
        </div>
      )}

      {/* Estado inicial vacío antes del primer escaneo */}
      {!scanSummary && !isScanning && (
        <section className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
            <HardDrive className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            Elige una unidad o carpeta para ver qué ocupa tu espacio
          </h2>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            DiskVault Clean analiza tus archivos en paralelo sin bloquear la pantalla, ordena todo de
            mayor a menor tamaño y clasifica el resultado en 7 secciones fáciles de entender.
          </p>
          <button
            type="button"
            onClick={() => void startScan()}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Escanear {selectedRootPath}</span>
          </button>
        </section>
      )}

      {/* Resultados del escaneo */}
      {scanSummary && (
        <>
          {/* Resumen visual por secciones */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <DiskTreemap
              sections={scanSummary.sections}
              totalBytes={scanSummary.totalBytes}
            />
            <CategoryCards sections={scanSummary.sections} />
          </section>

          {/* Pestañas de exploración */}
          <section className="space-y-4">
            <div
              role="tablist"
              aria-label="Vistas de exploración de espacio"
              className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900"
            >
              {EXPLORER_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'tree' && <SizeTreeTable />}
            {activeTab === 'top-files' && <TopFilesList mode="top-files" />}
            {activeTab === 'sections' && <TopFilesList mode="sections" />}
          </section>
        </>
      )}

      <TrashConfirmModal />
    </div>
  );
}
