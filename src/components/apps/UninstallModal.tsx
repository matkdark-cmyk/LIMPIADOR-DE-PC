import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useAppStore } from '../../store/useAppStore';
import { getEffectiveAppSize, useAppsStore } from '../../store/useAppsStore';
import { useScannerStore } from '../../store/useScannerStore';
import type {
  LeftoverCleanResult,
  LeftoverItem,
  RunningProcessInfo,
  UninstallExecutionResult,
} from '../../types';
import { formatBytes } from '../../utils/format';
import {
  invokeCheckAppRunningProcesses,
  invokeCleanAppLeftovers,
  invokeCloseAppProcesses,
  invokeRunAppUninstaller,
  invokeScanAppLeftovers,
} from '../../utils/tauri';

type ModalStep = 'confirm' | 'uninstalling' | 'scanning_leftovers' | 'leftovers' | 'done';

function extractErr(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado durante la desinstalación.';
}

export function UninstallModal() {
  const app = useAppsStore((s) => s.uninstallModalApp);
  const closeUninstallModal = useAppsStore((s) => s.closeUninstallModal);
  const loadApps = useAppsStore((s) => s.loadApps);
  const removeAppFromList = useAppsStore((s) => s.removeAppFromList);

  const isAdmin = useAppStore((s) => s.appStatus?.isAdmin ?? false);
  const isElevating = useAppStore((s) => s.isElevating);
  const requestAdminElevation = useAppStore((s) => s.requestAdminElevation);
  const refreshAuditLogs = useAppStore((s) => s.refreshAuditLogs);
  const addToast = useAppStore((s) => s.addToast);

  const [step, setStep] = useState<ModalStep>('confirm');
  const [runningProcesses, setRunningProcesses] = useState<RunningProcessInfo[]>([]);
  const [isCheckingProcs, setIsCheckingProcs] = useState(false);
  const [isClosingProcs, setIsClosingProcs] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsAdminError, setNeedsAdminError] = useState(false);

  const [uninstallResult, setUninstallResult] = useState<UninstallExecutionResult | null>(null);
  const [leftovers, setLeftovers] = useState<LeftoverItem[]>([]);
  const [selectedLeftoverIds, setSelectedLeftoverIds] = useState<Record<string, boolean>>({});
  const [useRecycleBin, setUseRecycleBin] = useState(true);
  const [isCleaningLeftovers, setIsCleaningLeftovers] = useState(false);
  const [cleanResult, setCleanResult] = useState<LeftoverCleanResult | null>(null);

  const checkProcesses = useCallback(async (appId: string) => {
    setIsCheckingProcs(true);
    try {
      const procs = await invokeCheckAppRunningProcesses(appId);
      setRunningProcesses(procs);
    } catch {
      setRunningProcesses([]);
    } finally {
      setIsCheckingProcs(false);
    }
  }, []);

  const isBusyUninstall =
    step === 'uninstalling' || step === 'scanning_leftovers' || isCleaningLeftovers || isClosingProcs;
  useEscapeKey(Boolean(app), closeUninstallModal, isBusyUninstall);

  useEffect(() => {
    if (!app) {
      return;
    }
    setStep('confirm');
    setRunningProcesses([]);
    setErrorMessage(null);
    setNeedsAdminError(false);
    setUninstallResult(null);
    setLeftovers([]);
    setSelectedLeftoverIds({});
    setUseRecycleBin(useAppStore.getState().settings.defaultUseRecycleBin);
    setIsCleaningLeftovers(false);
    setCleanResult(null);

    void checkProcesses(app.id);
  }, [app, checkProcesses]);

  const selectedLeftovers = useMemo(
    () => leftovers.filter((item) => selectedLeftoverIds[item.id]),
    [leftovers, selectedLeftoverIds],
  );

  const selectedLeftoverBytes = useMemo(
    () => selectedLeftovers.reduce((sum, item) => sum + item.sizeBytes, 0),
    [selectedLeftovers],
  );

  if (!app) {
    return null;
  }

  const requiresHklmAdmin =
    (app.registryHive === 'HKLM64' || app.registryHive === 'HKLM32') && !isAdmin;
  const approxSize = getEffectiveAppSize(app);
  const isBusy =
    step === 'uninstalling' || step === 'scanning_leftovers' || isCleaningLeftovers;

  const handleCloseProcesses = async () => {
    if (runningProcesses.length === 0) {
      return;
    }
    setIsClosingProcs(true);
    setErrorMessage(null);
    try {
      const pids = runningProcesses.map((p) => p.pid);
      await invokeCloseAppProcesses(pids);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      await checkProcesses(app.id);
    } catch (err) {
      setErrorMessage(extractErr(err));
    } finally {
      setIsClosingProcs(false);
    }
  };

  const handleStartUninstall = async () => {
    setErrorMessage(null);
    setNeedsAdminError(false);
    setStep('uninstalling');

    try {
      const result = await invokeRunAppUninstaller(app.id);
      setUninstallResult(result);
      void refreshAuditLogs(5);

      // Paso 2 automático: buscar residuos
      setStep('scanning_leftovers');
      try {
        const found = await invokeScanAppLeftovers({
          appName: app.name,
          publisher: app.publisher,
          oldInstallLocation: app.installLocation,
          registryHive: app.registryHive,
          registrySubkey: app.registrySubkey,
        });
        setLeftovers(found);
        const initialSelection: Record<string, boolean> = {};
        for (const item of found) {
          // Seguro: preseleccionado. Revisar: DESMARCADO por defecto.
          initialSelection[item.id] = item.risk === 'safe';
        }
        setSelectedLeftoverIds(initialSelection);
      } catch {
        setLeftovers([]);
      }

      if (result.completed) {
        removeAppFromList(app.id);
      }
      setStep('leftovers');
    } catch (err) {
      const msg = extractErr(err);
      if (msg.startsWith('NEEDS_ADMIN:')) {
        setNeedsAdminError(true);
        setErrorMessage(msg.replace(/^NEEDS_ADMIN:\s*/i, ''));
      } else {
        setErrorMessage(msg);
      }
      setStep('confirm');
    }
  };

  const handleCleanLeftovers = async () => {
    if (selectedLeftovers.length === 0) {
      setStep('done');
      return;
    }
    setIsCleaningLeftovers(true);
    setErrorMessage(null);
    try {
      const res = await invokeCleanAppLeftovers(
        selectedLeftovers.map((item) => ({
          path: item.path,
          itemType: item.itemType,
          registryHive: item.registryHive,
          registryKeyPath: item.registryKeyPath,
        })),
        useRecycleBin,
      );
      setCleanResult(res);
      setStep('done');
      void refreshAuditLogs(5);
      void useScannerStore.getState().loadSystemOverview(true);

      addToast({
        title: 'Residuos limpiados correctamente',
        message: `Se limpiaron ${res.cleanedCount} elemento(s) y se liberaron ${formatBytes(res.bytesFreed)}.`,
        variant: 'success',
      });
    } catch (err) {
      setErrorMessage(extractErr(err));
    } finally {
      setIsCleaningLeftovers(false);
    }
  };

  const handleFinishAndRefresh = () => {
    closeUninstallModal();
    void loadApps(true);
    void useScannerStore.getState().loadSystemOverview(true);
  };

  const toggleLeftover = (id: string) => {
    setSelectedLeftoverIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uninstall-modal-title"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {step === 'confirm' || step === 'uninstalling'
                ? 'Paso 1 de 2 · Desinstalador oficial'
                : step === 'scanning_leftovers' || step === 'leftovers'
                  ? 'Paso 2 de 2 · Limpieza guiada de residuos'
                  : 'Desinstalación finalizada'}
            </p>
            <h3
              id="uninstall-modal-title"
              className="mt-0.5 truncate text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {app.name}
            </h3>
          </div>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (step === 'leftovers' || step === 'done') {
                handleFinishAndRefresh();
              } else {
                closeUninstallModal();
              }
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Cerrar ventana"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* PASO 1: CONFIRMACIÓN */}
          {step === 'confirm' && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Fabricante: {app.publisher ?? 'No indicado'}
                  </p>
                  {app.installLocation && (
                    <p
                      className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
                      title={app.installLocation}
                    >
                      {app.installLocation}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Espacio aprox. a liberar
                  </p>
                  <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {approxSize > 0 ? formatBytes(approxSize) : 'Sin estimación'}
                  </p>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Se ejecutará primero el desinstalador oficial de Windows para quitar el programa de
                forma segura. Al finalizar, escanearemos si quedaron carpetas o archivos sobrantes
                para que elijas si deseas limpiarlos.
              </p>

              {/* Comprobación de procesos en ejecución */}
              {isCheckingProcs ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Comprobando si la aplicación está abierta actualmente...
                </div>
              ) : runningProcesses.length > 0 ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        Esta aplicación está abierta actualmente
                      </p>
                      <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300/90">
                        Conviene cerrarla antes de desinstalar para evitar archivos bloqueados.
                      </p>
                      <ul className="mt-2 space-y-1 font-mono text-xs text-amber-900 dark:text-amber-200">
                        {runningProcesses.slice(0, 5).map((proc) => (
                          <li key={proc.pid} className="flex items-center justify-between gap-2">
                            <span className="truncate">{proc.name}</span>
                            <span className="shrink-0 tabular-nums opacity-80">
                              {formatBytes(proc.memoryBytes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <button
                      type="button"
                      disabled={isClosingProcs}
                      onClick={() => {
                        void handleCloseProcesses();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isClosingProcs && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Cerrar aplicación y continuar
                    </button>
                    <button
                      type="button"
                      disabled={isClosingProcs}
                      onClick={() => {
                        void checkProcesses(app.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Volver a comprobar
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Aviso de Modo Administrador si aplica */}
              {(requiresHklmAdmin || needsAdminError) && (
                <div className="space-y-2.5 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <div className="text-xs leading-relaxed text-blue-900 dark:text-blue-200">
                      <p className="font-semibold">Se requieren permisos de Administrador</p>
                      <p className="mt-0.5 opacity-90">
                        Esta aplicación está instalada para todo el equipo. Activa el Modo
                        Administrador para permitir que Windows la desinstale y limpie sus claves.
                      </p>
                    </div>
                  </div>
                  <div className="pl-7">
                    <button
                      type="button"
                      disabled={isElevating}
                      onClick={() => {
                        void requestAdminElevation();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isElevating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Activar Modo Administrador
                    </button>
                  </div>
                </div>
              )}

              {errorMessage && !needsAdminError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  {errorMessage}
                </div>
              )}
            </>
          )}

          {/* ESPERANDO DESINSTALADOR */}
          {step === 'uninstalling' && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Esperando a que completes el desinstalador de Windows...
                </p>
                <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">
                  Sigue las instrucciones en la ventana oficial del programa. Al cerrarse,
                  buscaremos automáticamente si quedaron archivos residuales.
                </p>
              </div>
            </div>
          )}

          {/* ESCANEANDO RESIDUOS */}
          {step === 'scanning_leftovers' && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Buscando carpetas y archivos sobrantes...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Comprobando ubicaciones seguras de la aplicación sin tocar carpetas de otros
                  programas.
                </p>
              </div>
            </div>
          )}

          {/* PASO 2: CHECKLIST DE RESIDUOS */}
          {step === 'leftovers' && (
            <>
              {uninstallResult && (
                <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{uninstallResult.message}</span>
                </div>
              )}

              {leftovers.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-6 text-center dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                    No quedaron residuos detectados
                  </p>
                  <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    El desinstalador oficial dejó el equipo limpio.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Se encontraron {leftovers.length} elemento(s) residual(es)
                    </p>
                    <p className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      Seleccionados: {selectedLeftovers.length} ({formatBytes(selectedLeftoverBytes)})
                    </p>
                  </div>

                  <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {leftovers.map((item) => {
                      const checked = Boolean(selectedLeftoverIds[item.id]);
                      const isSafe = item.risk === 'safe';
                      return (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLeftover(item.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                                {item.itemType === 'folder' ? (
                                  <Folder className="h-3.5 w-3.5 text-slate-400" />
                                ) : item.itemType === 'registry' ? (
                                  <Database className="h-3.5 w-3.5 text-slate-400" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                                )}
                                <span
                                  className={
                                    isSafe
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }
                                >
                                  {isSafe ? 'Seguro' : 'Revisar'}
                                </span>
                              </span>

                              <span className="font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                                {item.itemType === 'registry'
                                  ? 'Registro'
                                  : formatBytes(item.sizeBytes)}
                              </span>
                            </div>

                            <p
                              className="mt-0.5 truncate font-mono text-xs text-slate-800 dark:text-slate-200"
                              title={item.path}
                            >
                              {item.path}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {item.reason}
                              {!isSafe && ' · Puede contener configuraciones o partidas guardadas.'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-700 select-none dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={useRecycleBin}
                      onChange={(e) => setUseRecycleBin(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                    />
                    Enviar archivos y carpetas residuales a la Papelera de Reciclaje (recomendado)
                  </label>
                </>
              )}

              {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  {errorMessage}
                </div>
              )}
            </>
          )}

          {/* RESULTADO FINAL */}
          {step === 'done' && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Limpieza finalizada
                  </p>
                  {cleanResult ? (
                    <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
                      Se limpiaron{' '}
                      <strong className="font-mono tabular-nums">{cleanResult.cleanedCount}</strong>{' '}
                      elemento(s) residual(es) y se recuperaron{' '}
                      <strong className="font-mono tabular-nums">
                        {formatBytes(cleanResult.bytesFreed)}
                      </strong>
                      {useRecycleBin ? ' (enviados a la Papelera de Reciclaje).' : '.'}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
                      La desinstalación terminó sin eliminar archivos residuales adicionales.
                    </p>
                  )}
                </div>
              </div>

              {cleanResult && cleanResult.errors.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-semibold">
                    Algunos elementos no pudieron eliminarse ({cleanResult.failedCount}):
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {cleanResult.errors.slice(0, 4).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pie con acciones */}
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50/60 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={closeUninstallModal}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={requiresHklmAdmin || isCheckingProcs || isClosingProcs}
                onClick={() => {
                  void handleStartUninstall();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Iniciar desinstalador oficial
              </button>
            </>
          )}

          {step === 'leftovers' && (
            <>
              <button
                type="button"
                disabled={isCleaningLeftovers}
                onClick={handleFinishAndRefresh}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {leftovers.length === 0 ? 'Finalizar' : 'Omitir'}
              </button>
              {leftovers.length > 0 && (
                <button
                  type="button"
                  disabled={isCleaningLeftovers || selectedLeftovers.length === 0}
                  onClick={() => {
                    void handleCleanLeftovers();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCleaningLeftovers ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Limpiar residuos seleccionados
                </button>
              )}
            </>
          )}

          {step === 'done' && (
            <button
              type="button"
              onClick={handleFinishAndRefresh}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Cerrar y actualizar lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
