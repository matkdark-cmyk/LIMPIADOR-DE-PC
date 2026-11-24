import { useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useCleanerStore } from '../../store/useCleanerStore';
import type { CacheGroup, CacheTarget, InactiveDaysOption } from '../../types';
import { formatBytes, formatDuration, formatNumber } from '../../utils/format';
import { CacheGroupSection } from './CacheGroupSection';
import { CleanConfirmModal } from './CleanConfirmModal';

const GROUP_ORDER: CacheGroup[] = [
  'windows_system',
  'browsers',
  'inactive_apps',
  'graphics_shaders',
  'recycle_bin',
];

const INACTIVE_OPTIONS: InactiveDaysOption[] = [15, 30, 60, 90];

export function CleanerView() {
  const isTauri = useAppStore((s) => s.isTauri);
  const isElevating = useAppStore((s) => s.isElevating);
  const requestAdminElevation = useAppStore((s) => s.requestAdminElevation);

  const report = useCleanerStore((s) => s.report);
  const hasScannedOnce = useCleanerStore((s) => s.hasScannedOnce);
  const isScanning = useCleanerStore((s) => s.isScanning);
  const scanProgress = useCleanerStore((s) => s.scanProgress);
  const scanError = useCleanerStore((s) => s.scanError);

  const inactiveDaysThreshold = useCleanerStore((s) => s.inactiveDaysThreshold);
  const useRecycleBin = useCleanerStore((s) => s.useRecycleBin);
  const selectedIds = useCleanerStore((s) => s.selectedIds);
  const closingTargetId = useCleanerStore((s) => s.closingTargetId);
  const isCleaning = useCleanerStore((s) => s.isCleaning);
  const cleanProgress = useCleanerStore((s) => s.cleanProgress);
  const lastResult = useCleanerStore((s) => s.lastResult);
  const confirmModalOpen = useCleanerStore((s) => s.confirmModalOpen);

  const scanCaches = useCleanerStore((s) => s.scanCaches);
  const setInactiveDaysThreshold = useCleanerStore((s) => s.setInactiveDaysThreshold);
  const setUseRecycleBin = useCleanerStore((s) => s.setUseRecycleBin);
  const toggleTarget = useCleanerStore((s) => s.toggleTarget);
  const selectAllSafe = useCleanerStore((s) => s.selectAllSafe);
  const deselectAll = useCleanerStore((s) => s.deselectAll);
  const closeBlockingApps = useCleanerStore((s) => s.closeBlockingApps);
  const openConfirmModal = useCleanerStore((s) => s.openConfirmModal);
  const closeConfirmModal = useCleanerStore((s) => s.closeConfirmModal);
  const runCleanup = useCleanerStore((s) => s.runCleanup);
  const clearLastResult = useCleanerStore((s) => s.clearLastResult);

  const targetsByGroup = useMemo(() => {
    const map: Record<CacheGroup, CacheTarget[]> = {
      windows_system: [],
      browsers: [],
      inactive_apps: [],
      graphics_shaders: [],
      recycle_bin: [],
    };
    if (!report) {
      return map;
    }
    for (const target of report.targets) {
      map[target.group].push(target);
    }
    return map;
  }, [report]);

  const selectedTargets = useMemo(() => {
    if (!report) {
      return [];
    }
    return report.targets.filter(
      (t) => selectedIds[t.id] && (!t.requiresAdmin || report.isAdmin),
    );
  }, [report, selectedIds]);

  const selectedTotalBytes = useMemo(
    () => selectedTargets.reduce((sum, t) => sum + t.sizeBytes, 0),
    [selectedTargets],
  );

  // Navegadores abiertos entre los targets seleccionados
  const runningSelectedBrowsers = useMemo(
    () =>
      selectedTargets.filter(
        (t) => t.group === 'browsers' && t.isLockedByRunningApp,
      ),
    [selectedTargets],
  );

  const runningBrowserNamesLabel = useMemo(
    () =>
      runningSelectedBrowsers
        .map((b) => b.name.replace('Caché de ', ''))
        .join(' / '),
    [runningSelectedBrowsers],
  );

  const runningBrowserProcs = useMemo(
    () => runningSelectedBrowsers.flatMap((b) => b.runningProcessNames),
    [runningSelectedBrowsers],
  );

  if (!isTauri) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Limpiador de Caché de Windows, Navegadores y Aplicaciones sin Uso
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Analiza temporales de Windows, descargas de Windows Update, cachés de navegadores
                (sin tocar contraseñas ni cookies), shaders gráficos, apps inactivas y la Papelera
                de Reciclaje con semáforo de seguridad.
              </p>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Ejecuta{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  npm run tauri dev
                </code>{' '}
                en tu PC con Windows para analizar y limpiar tu equipo real.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const scanPct =
    scanProgress && scanProgress.totalTargets > 0
      ? Math.min(100, Math.round((scanProgress.scannedTargets / scanProgress.totalTargets) * 100))
      : 0;

  const cleanPct =
    cleanProgress && cleanProgress.targetsTotal > 0
      ? Math.min(100, Math.round((cleanProgress.targetsDone / cleanProgress.targetsTotal) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 1. TARJETA PRINCIPAL (HERO DE ANÁLISIS RÁPIDO) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {!hasScannedOnce && !isScanning ? (
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                <ShieldCheck className="h-4 w-4" />
                Limpieza guiada con semáforo de seguridad
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Recupera gigabytes eliminando temporales y cachés que ya no necesitas
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Revisaremos archivos temporales de Windows, caché de navegadores (sin tocar
                contraseñas ni sesiones), shaders gráficos y aplicaciones sin actividad reciente
                para que elijas exactamente qué limpiar.
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2.5 sm:items-end">
              <button
                type="button"
                onClick={() => {
                  void scanCaches(true);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Search className="h-4 w-4" />
                Analizar Espacio Recuperable
              </button>

              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <label htmlFor="inactive-days-initial">Apps sin uso hace más de:</label>
                <select
                  id="inactive-days-initial"
                  value={inactiveDaysThreshold}
                  onChange={(e) => {
                    void setInactiveDaysThreshold(Number(e.target.value) as InactiveDaysOption);
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {INACTIVE_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} días
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : isScanning ? (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                Analizando {scanProgress?.currentGroup ?? 'cachés del sistema'}...
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                {formatBytes(scanProgress?.bytesFound ?? 0)} encontrados ({scanPct}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-200"
                style={{ width: `${Math.max(8, scanPct)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Escaneando solo carpetas temporales y de caché; tus documentos personales no se tocan.
            </p>
          </div>
        ) : report ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Análisis completado en {formatDuration(report.durationMs)} · Total detectado:{' '}
                  <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {formatBytes(report.totalReclaimableBytes)}
                  </span>
                </p>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Puedes liberar{' '}
                  <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {formatBytes(selectedTotalBytes)}
                  </span>{' '}
                  {selectedTargets.every((t) => t.safety === 'safe')
                    ? 'de forma segura'
                    : 'seleccionados'}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={isCleaning}
                  onClick={() => {
                    void scanCaches(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Volver a analizar
                </button>

                <button
                  type="button"
                  disabled={isCleaning || selectedTargets.length === 0}
                  onClick={openConfirmModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCleaning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Limpiar Selección ({formatBytes(selectedTotalBytes)})
                </button>
              </div>
            </div>

            {/* Controles rápidos: umbral de inactividad + Solo Seguros / Deseleccionar todo */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                <label htmlFor="inactive-days-select" className="font-medium">
                  Apps sin uso hace más de:
                </label>
                <select
                  id="inactive-days-select"
                  disabled={isCleaning}
                  value={inactiveDaysThreshold}
                  onChange={(e) => {
                    void setInactiveDaysThreshold(Number(e.target.value) as InactiveDaysOption);
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {INACTIVE_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} días
                    </option>
                  ))}
                </select>

                <span className="hidden text-slate-300 sm:inline dark:text-slate-700">|</span>

                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Seguros:{' '}
                  <strong className="font-mono tabular-nums">
                    {formatBytes(report.safeReclaimableBytes)}
                  </strong>
                </span>

                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Revisar:{' '}
                  <strong className="font-mono tabular-nums">
                    {formatBytes(report.reviewReclaimableBytes)}
                  </strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isCleaning}
                  onClick={selectAllSafe}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Solo Seguros
                </button>
                <button
                  type="button"
                  disabled={isCleaning}
                  onClick={deselectAll}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Deseleccionar todo
                </button>
              </div>
            </div>

            {/* 2. INTERRUPTOR DE MODO DE BORRADO (CLARO Y HONESTO) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label
                  htmlFor="recycle-bin-mode-switch"
                  className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-slate-800 select-none dark:text-slate-200"
                >
                  <Trash2 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  Enviar archivos de caché a la Papelera (respaldo temporal)
                </label>

                <button
                  id="recycle-bin-mode-switch"
                  type="button"
                  role="switch"
                  aria-checked={useRecycleBin}
                  disabled={isCleaning}
                  onClick={() => setUseRecycleBin(!useRecycleBin)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 ${
                    useRecycleBin ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      useRecycleBin ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {useRecycleBin
                  ? 'Activado: los archivos de caché de usuario se enviarán primero a la Papelera de Reciclaje por seguridad y podrás vaciarla después. (Las cachés internas de Windows Update y Windows\\Temp siempre se purgan directamente).'
                  : 'Desactivado: los archivos seleccionados se eliminarán de forma directa y el espacio libre en tu disco se recuperará al instante.'}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* 3. BANNER INTELIGENTE DE NAVEGADORES ABIERTOS */}
      {runningSelectedBrowsers.length > 0 && !isCleaning && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Detectamos que <strong>{runningBrowserNamesLabel}</strong> está abierto. Ciérralo
              antes de limpiar para recuperar el 100% de su caché, o continúa para limpiar el resto.
            </span>
          </div>

          <button
            type="button"
            disabled={closingTargetId !== null}
            onClick={() => {
              void closeBlockingApps('all_browsers_banner', runningBrowserProcs);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {closingTargetId === 'all_browsers_banner' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Cerrar navegador(es)
          </button>
        </div>
      )}

      {/* BANNER DISCRETO DE PERMISOS DE ADMINISTRADOR */}
      {report && !report.isAdmin && report.adminLockedBytes > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-5 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="flex items-center gap-3 text-xs text-blue-900 dark:text-blue-200">
            <Lock className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>
              Hay{' '}
              <strong className="font-mono tabular-nums">
                {formatBytes(report.adminLockedBytes)}
              </strong>{' '}
              adicionales en cachés del sistema (Windows Update,{' '}
              <code className="font-mono">Windows\Temp</code> y Optimización de entrega). Activa el
              Modo Administrador para desbloquearlos.
            </span>
          </div>
          <button
            type="button"
            disabled={isElevating}
            onClick={() => {
              void requestAdminElevation();
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isElevating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Activar Modo Administrador
          </button>
        </div>
      )}

      {/* PROGRESO EN VIVO DURANTE LA LIMPIEZA */}
      {isCleaning && cleanProgress && (
        <section className="space-y-2.5 rounded-xl border border-blue-200 bg-blue-50/50 p-5 dark:border-blue-900/50 dark:bg-blue-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
              Limpiando: {cleanProgress.currentTargetName}
            </span>
            <span className="font-mono font-bold tabular-nums text-blue-700 dark:text-blue-400">
              {cleanProgress.targetsDone} / {cleanProgress.targetsTotal} ·{' '}
              {formatBytes(cleanProgress.bytesFreedSoFar)} liberados
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-200"
              style={{ width: `${Math.max(5, cleanPct)}%` }}
            />
          </div>
        </section>
      )}

      {/* 5. TARJETA DE RESULTADO FINAL CELEBRATORIA Y TRANSPARENTE */}
      {lastResult && !isCleaning && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/75 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                  ¡Listo! Se liberaron {formatBytes(lastResult.bytesFreed)}
                </h3>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Se limpiaron{' '}
                  <strong className="font-mono tabular-nums">
                    {formatNumber(lastResult.filesDeleted)}
                  </strong>{' '}
                  archivos en {formatDuration(lastResult.durationMs)}.
                </p>
                {lastResult.filesSkippedInUse > 0 && (
                  <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90">
                    Se omitieron{' '}
                    <strong className="font-mono tabular-nums">
                      {formatNumber(lastResult.filesSkippedInUse)}
                    </strong>{' '}
                    archivos que Windows o algún programa estaba usando en este momento — es
                    completamente normal.
                  </p>
                )}
                {lastResult.wuauservRestarted && (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    El servicio Windows Update (wuauserv) se restauró automáticamente al finalizar.
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={clearLastResult}
              aria-label="Cerrar resumen"
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ERROR DE ESCANEO */}
      {scanError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}

      {/* 4. LISTA AGRUPADA POR CATEGORÍAS */}
      {report && !isScanning && report.targets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white py-14 text-center dark:border-emerald-900/40 dark:bg-slate-900">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Tu equipo está muy limpio
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No se encontraron archivos temporales ni cachés relevantes pendientes de limpiar.
          </p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          {GROUP_ORDER.map((group) => (
            <CacheGroupSection
              key={group}
              group={group}
              targets={targetsByGroup[group]}
              isAdmin={report.isAdmin}
              selectedIds={selectedIds}
              closingTargetId={closingTargetId}
              isCleaning={isCleaning}
              onToggleTarget={toggleTarget}
              onCloseBlockingApps={(targetId, procs) => {
                void closeBlockingApps(targetId, procs);
              }}
            />
          ))}
        </div>
      ) : null}

      <CleanConfirmModal
        open={confirmModalOpen}
        selectedTargets={selectedTargets}
        useRecycleBin={useRecycleBin}
        onClose={closeConfirmModal}
        onConfirm={(closeRunning) => {
          void runCleanup(closeRunning);
        }}
      />
    </div>
  );
}
