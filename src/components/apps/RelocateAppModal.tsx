import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  FolderOutput,
  HardDrive,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useAppStore } from '../../store/useAppStore';
import { getEffectiveAppSize, useAppsStore } from '../../store/useAppsStore';
import { useNasStore } from '../../store/useNasStore';
import { useScannerStore } from '../../store/useScannerStore';
import type { DiskInfo, RelocatePreflight, TransferResult } from '../../types';
import { formatBytes, formatSpeed } from '../../utils/format';
import { formatEta } from '../../utils/formatters';
import {
  invokeCancelTransfer,
  invokeExecuteRelocateApp,
  invokeOpenInExplorer,
  invokePreflightRelocateApp,
  pickFolderDialog,
} from '../../utils/tauri';

function extractErr(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al reubicar la aplicación.';
}

function getDrivePrefix(path: string | null): string {
  if (!path || path.length < 2) {
    return '';
  }
  return path.slice(0, 2).toUpperCase();
}

const EMPTY_DISKS: DiskInfo[] = [];

export function RelocateAppModal() {
  const app = useAppsStore((s) => s.relocateModalApp);
  const closeRelocateModal = useAppsStore((s) => s.closeRelocateModal);
  const markAppRelocated = useAppsStore((s) => s.markAppRelocated);

  const isElevating = useAppStore((s) => s.isElevating);
  const requestAdminElevation = useAppStore((s) => s.requestAdminElevation);
  const refreshAuditLogs = useAppStore((s) => s.refreshAuditLogs);
  const addToast = useAppStore((s) => s.addToast);

  const disks = useScannerStore((s) => s.systemOverview?.disks ?? EMPTY_DISKS);
  const loadSystemOverview = useScannerStore((s) => s.loadSystemOverview);

  const transferProgress = useNasStore((s) => s.transferProgress);
  const clearLastTransferBanner = useNasStore((s) => s.clearLastTransferBanner);

  const [destParentDir, setDestParentDir] = useState('');
  const [preflight, setPreflight] = useState<RelocatePreflight | null>(null);
  const [isCheckingPreflight, setIsCheckingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [closeRunningFirst, setCloseRunningFirst] = useState(true);

  const [isRelocating, setIsRelocating] = useState(false);
  const [relocateError, setRelocateError] = useState<string | null>(null);
  const [needsAdminError, setNeedsAdminError] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);

  useEscapeKey(Boolean(app), closeRelocateModal, isRelocating);

  useEffect(() => {
    if (!app) {
      return;
    }
    setDestParentDir('');
    setPreflight(null);
    setPreflightError(null);
    setCloseRunningFirst(true);
    setIsRelocating(false);
    setRelocateError(null);
    setNeedsAdminError(false);
    setResult(null);
    clearLastTransferBanner();

    if (disks.length === 0) {
      void loadSystemOverview(false);
    }
  }, [app, clearLastTransferBanner, disks.length, loadSystemOverview]);

  const runPreflight = useCallback(async (appId: string, dest: string) => {
    const trimmed = dest.trim();
    if (!trimmed) {
      setPreflight(null);
      setPreflightError(null);
      return;
    }
    setIsCheckingPreflight(true);
    setPreflightError(null);
    try {
      const info = await invokePreflightRelocateApp(appId, trimmed);
      setPreflight(info);
      setPreflightError(null);
    } catch (err) {
      setPreflight(null);
      setPreflightError(extractErr(err));
    } finally {
      setIsCheckingPreflight(false);
    }
  }, []);

  // Ejecuta verificación previa automáticamente cuando cambia la carpeta destino
  useEffect(() => {
    if (!app || isRelocating || result) {
      return;
    }
    if (!destParentDir.trim()) {
      setPreflight(null);
      setPreflightError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runPreflight(app.id, destParentDir);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [app, destParentDir, isRelocating, result, runPreflight]);

  const suggestedDrives = useMemo(() => {
    if (!app) {
      return [];
    }
    const sourceDrive = getDrivePrefix(app.installLocation);
    return disks.filter((d) => {
      const mountPrefix = getDrivePrefix(d.mountPoint);
      return mountPrefix.length === 2 && mountPrefix !== sourceDrive;
    });
  }, [app, disks]);

  if (!app) {
    return null;
  }

  const handlePickDest = async () => {
    try {
      const chosen = await pickFolderDialog(
        'Elegir carpeta destino en otro disco local (ej. D:\\Aplicaciones)',
      );
      if (chosen) {
        setDestParentDir(chosen);
      }
    } catch (err) {
      addToast({
        title: 'No se pudo abrir el selector de carpetas',
        message: extractErr(err),
        variant: 'error',
      });
    }
  };

  const handleStartRelocate = async () => {
    if (!preflight || isRelocating) {
      return;
    }
    setRelocateError(null);
    setNeedsAdminError(false);
    setIsRelocating(true);
    clearLastTransferBanner();

    try {
      const res = await invokeExecuteRelocateApp(
        app.id,
        destParentDir.trim(),
        closeRunningFirst,
      );
      setResult(res);
      setIsRelocating(false);

      markAppRelocated(app.id, res.destPath);
      void loadSystemOverview(true);
      void refreshAuditLogs(5);

      addToast({
        title: 'Aplicación movida con éxito',
        message: `Se liberaron ${formatBytes(res.totalBytes)} en la unidad de origen y el enlace NTFS quedó activo.`,
        variant: 'success',
        durationMs: 6500,
      });
    } catch (err) {
      const msg = extractErr(err);
      setIsRelocating(false);
      if (msg.startsWith('NEEDS_ADMIN:')) {
        setNeedsAdminError(true);
        setRelocateError(msg.replace(/^NEEDS_ADMIN:\s*/i, ''));
      } else {
        setRelocateError(msg);
      }
      void refreshAuditLogs(5);
    }
  };

  const handleOpenDest = async () => {
    if (!result) {
      return;
    }
    try {
      await invokeOpenInExplorer(result.destPath);
    } catch (err) {
      addToast({
        title: 'No se pudo abrir la carpeta destino',
        message: extractErr(err),
        variant: 'error',
      });
    }
  };

  const activePhase = transferProgress?.phase ?? 'preparing';
  const phaseStepIndex =
    activePhase === 'verifying'
      ? 2
      : activePhase === 'cleaning' || activePhase === 'completed'
        ? 3
        : 1;

  const canExecute =
    Boolean(preflight) &&
    preflight!.fitsInDestination &&
    !preflight!.destAlreadyExists &&
    (!preflight!.requiresAdmin || preflight!.isAdmin) &&
    !isCheckingPreflight &&
    !isRelocating;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="relocate-modal-title"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              Reubicar aplicación a otro disco local
            </p>
            <h3
              id="relocate-modal-title"
              className="mt-0.5 truncate text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {app.name}
            </h3>
          </div>

          <button
            type="button"
            disabled={isRelocating}
            onClick={closeRelocateModal}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Cerrar ventana"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!result && (
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Mueve la carpeta de esta aplicación a otro disco local y crea un enlace automático para
              que siga funcionando sin reinstalarla.
            </p>
          )}

          {/* Origen actual */}
          {!result && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-500 uppercase dark:text-slate-400">
                  Ubicación actual
                </p>
                <p
                  className="mt-0.5 truncate font-mono text-xs text-slate-800 dark:text-slate-200"
                  title={app.installLocation ?? ''}
                >
                  {app.installLocation}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Tamaño</p>
                <p className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatBytes(preflight?.sizeBytes ?? getEffectiveAppSize(app))}
                </p>
              </div>
            </div>
          )}

          {/* Selector de destino (cuando no está transfiriendo ni finalizado) */}
          {!isRelocating && !result && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="relocate-dest-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  Carpeta de destino en otro disco local NTFS
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="relocate-dest-input"
                    type="text"
                    value={destParentDir}
                    onChange={(e) => setDestParentDir(e.target.value)}
                    placeholder="Ej. D:\Aplicaciones o E:\Juegos"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handlePickDest();
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Elegir carpeta
                  </button>
                </div>
              </div>

              {/* Atajos a otros discos locales detectados */}
              {suggestedDrives.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Discos disponibles:
                  </span>
                  {suggestedDrives.map((disk) => {
                    const base = disk.mountPoint.endsWith('\\')
                      ? `${disk.mountPoint}DiskVaultApps`
                      : `${disk.mountPoint}\\DiskVaultApps`;
                    return (
                      <button
                        key={disk.mountPoint}
                        type="button"
                        onClick={() => setDestParentDir(base)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/40"
                      >
                        <HardDrive className="h-3 w-3" />
                        <span className="font-mono">{disk.mountPoint}</span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          ({formatBytes(disk.availableBytes)} libres)
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Estado de verificación previa */}
              {isCheckingPreflight && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  Calculando peso real, espacio libre y verificando requisitos...
                </div>
              )}

              {preflightError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{preflightError}</span>
                </div>
              )}

              {/* Resultado del Preflight */}
              {preflight && !isCheckingPreflight && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Peso exacto a mover
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatBytes(preflight.sizeBytes)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Espacio libre en destino
                      </p>
                      <p
                        className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                          preflight.fitsInDestination
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatBytes(preflight.destFreeBytes)}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Carpeta destino final
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-xs text-slate-800 dark:text-slate-200"
                      title={preflight.resolvedDestPath}
                    >
                      {preflight.resolvedDestPath}
                    </p>
                  </div>

                  {!preflight.fitsInDestination && (
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">
                      No hay espacio suficiente en el disco destino (se necesitan al menos{' '}
                      {formatBytes(preflight.requiredBytes)} incluyendo margen de seguridad).
                    </p>
                  )}

                  {preflight.destAlreadyExists && (
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">
                      Ya existe una carpeta con ese mismo nombre en el destino. Elige otra carpeta o
                      vacíala primero.
                    </p>
                  )}

                  {/* Procesos en ejecución */}
                  {preflight.runningProcesses.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                        La aplicación está abierta ({preflight.runningProcesses.length} proceso(s))
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-amber-900 select-none dark:text-amber-200">
                        <input
                          type="checkbox"
                          checked={closeRunningFirst}
                          onChange={(e) => setCloseRunningFirst(e.target.checked)}
                          className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                        />
                        Cerrar automáticamente antes de mover para evitar archivos bloqueados
                      </label>
                    </div>
                  )}

                  {/* Aviso UAC si la app está en Program Files / ProgramData */}
                  {preflight.requiresAdmin && !preflight.isAdmin && (
                    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-900/50 dark:bg-blue-950/30">
                      <div className="flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span>
                          Esta aplicación está en <strong>Archivos de Programa</strong>. Activa el
                          Modo Administrador para poder moverla y crear el enlace NTFS.
                        </span>
                      </div>
                      <div className="pl-6">
                        <button
                          type="button"
                          disabled={isElevating}
                          onClick={() => {
                            void requestAdminElevation();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isElevating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Activar Modo Administrador
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error de ejecución */}
              {relocateError && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  <p>{relocateError}</p>
                  {needsAdminError && (
                    <button
                      type="button"
                      disabled={isElevating}
                      onClick={() => {
                        void requestAdminElevation();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Activar Modo Administrador
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PROGRESO EN VIVO EN 3 FASES */}
          {isRelocating && (
            <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-5 dark:border-blue-900/50 dark:bg-blue-950/20">
              {/* Indicador de las 3 fases */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { idx: 1, label: '1. Copiando' },
                  { idx: 2, label: '2. Verificando xxHash3' },
                  { idx: 3, label: '3. Enlace y liberación' },
                ].map((stage) => {
                  const isCurrent = phaseStepIndex === stage.idx;
                  const isDone = phaseStepIndex > stage.idx;
                  return (
                    <div
                      key={stage.idx}
                      className={`rounded-lg border px-2.5 py-2 text-center font-semibold ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : isDone
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {stage.label}
                    </div>
                  );
                })}
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                    {phaseStepIndex === 1
                      ? 'Copiando archivos al nuevo disco...'
                      : phaseStepIndex === 2
                        ? 'Verificando integridad bloque a bloque con xxHash3...'
                        : 'Creando enlace NTFS y liberando espacio original...'}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-blue-700 dark:text-blue-400">
                    {Math.round(transferProgress?.percent ?? 0)}%
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-200"
                    style={{ width: `${Math.max(3, transferProgress?.percent ?? 3)}%` }}
                  />
                </div>
              </div>

              {transferProgress && (
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Progreso</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatBytes(transferProgress.bytesProcessed)} /{' '}
                      {formatBytes(transferProgress.totalBytes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Velocidad</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatSpeed(transferProgress.speedBytesPerSec)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Tiempo restante</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatEta(transferProgress.etaSeconds)}
                    </p>
                  </div>
                </div>
              )}

              {transferProgress?.currentFile && (
                <p
                  className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
                  title={transferProgress.currentFile}
                >
                  Archivo actual: {transferProgress.currentFile}
                </p>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Tu aplicación original permanece intacta hasta que la verificación pase al 100%.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void invokeCancelTransfer();
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* RECIBO DE ÉXITO */}
          {result && (
            <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h4 className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                    Aplicación movida y verificada con xxHash3
                  </h4>
                  <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
                    Se liberaron{' '}
                    <strong className="font-mono tabular-nums">
                      {formatBytes(result.totalBytes)}
                    </strong>{' '}
                    en el disco original ({result.filesCount} archivos verificados). Todos tus
                    accesos directos seguirán funcionando con normalidad.
                  </p>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-emerald-200/80 bg-white/80 p-3.5 text-xs dark:border-emerald-900/40 dark:bg-slate-900/60">
                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="truncate">{result.sourcePath}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate font-semibold text-emerald-700 dark:text-emerald-400">
                    {result.destPath}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50/60 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
          {!isRelocating && !result && (
            <>
              <button
                type="button"
                onClick={closeRelocateModal}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!canExecute}
                onClick={() => {
                  void handleStartRelocate();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOutput className="h-3.5 w-3.5" />
                Mover aplicación con verificación xxHash3
              </button>
            </>
          )}

          {result && (
            <>
              <button
                type="button"
                onClick={() => {
                  void handleOpenDest();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Abrir destino
              </button>
              <button
                type="button"
                onClick={closeRelocateModal}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Finalizar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
