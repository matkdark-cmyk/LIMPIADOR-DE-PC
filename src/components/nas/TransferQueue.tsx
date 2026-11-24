import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { useNasStore } from '../../store/useNasStore';
import { useScannerStore } from '../../store/useScannerStore';
import type { TransferPhase } from '../../types';
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatNumber,
  formatPercent,
  formatSpeed,
} from '../../utils/formatters';

function getPhaseStepIndex(phase: TransferPhase): number {
  switch (phase) {
    case 'preparing':
    case 'copying':
      return 1;
    case 'verifying':
      return 2;
    case 'cleaning':
    case 'completed':
      return 3;
    case 'failed':
    case 'cancelled':
      return 0;
  }
}

export function TransferQueue() {
  const isTransferring = useNasStore((state) => state.isTransferring);
  const isPaused = useNasStore((state) => state.isPaused);
  const transferProgress = useNasStore((state) => state.transferProgress);
  const lastTransferResult = useNasStore((state) => state.lastTransferResult);
  const lastTransferError = useNasStore((state) => state.lastTransferError);
  const togglePauseTransfer = useNasStore((state) => state.togglePauseTransfer);
  const cancelTransfer = useNasStore((state) => state.cancelTransfer);
  const clearLastTransferBanner = useNasStore((state) => state.clearLastTransferBanner);
  const openInExplorer = useScannerStore((state) => state.openInExplorer);

  if (!isTransferring && !lastTransferResult && !lastTransferError) {
    return null;
  }

  // Tarjeta de resultado completado con verificación 100%
  if (!isTransferring && lastTransferResult) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-white p-5 dark:border-emerald-800/70 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Migración verificada con xxHash3 al 100%
              </h3>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {lastTransferResult.summaryMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                <span>{formatNumber(lastTransferResult.filesCount)} archivos</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {formatBytes(lastTransferResult.totalBytes)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(lastTransferResult.durationMs)}</span>
                {lastTransferResult.retriesCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{lastTransferResult.retriesCount} reintentos de red superados</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void openInExplorer(lastTransferResult.destPath)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Abrir destino</span>
            </button>
            <button
              type="button"
              onClick={clearLastTransferBanner}
              aria-label="Cerrar resumen"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Tarjeta de error / cancelación confirmando que el origen local sigue 100% intacto
  if (!isTransferring && lastTransferError) {
    return (
      <section className="rounded-xl border border-amber-200 bg-white p-5 dark:border-amber-800/70 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Operación detenida — Tu carpeta original local está 100% intacta
              </h3>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {lastTransferError}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearLastTransferBanner}
            aria-label="Cerrar aviso"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </section>
    );
  }

  // Transferencia activa en curso (Pipeline 3 Fases)
  const progress = transferProgress;
  const activeStep = progress ? getPhaseStepIndex(progress.phase) : 1;
  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;

  const phaseTitle =
    progress?.phase === 'verifying'
      ? 'Fase 2 de 3: Verificando integridad xxHash3 bloque a bloque...'
      : progress?.phase === 'cleaning'
        ? 'Fase 3 de 3: Aplicando cierre y limpieza local...'
        : progress?.phase === 'preparing'
          ? 'Preparando inventario de archivos...'
          : isPaused
            ? 'Transferencia en pausa'
            : 'Fase 1 de 3: Copiando archivos por streaming...';

  const steps = [
    { num: 1, label: '1. Copia streaming' },
    { num: 2, label: '2. Verificación xxHash3' },
    { num: 3, label: '3. Cierre seguro' },
  ];

  return (
    <section className="space-y-4 rounded-xl border border-blue-200 bg-white p-5 dark:border-blue-800/70 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          {isPaused ? (
            <Pause className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
          )}
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {phaseTitle}
          </h3>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void togglePauseTransfer()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {isPaused ? (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Reanudar</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Pausar</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void cancelTransfer()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap dark:bg-red-500 dark:hover:bg-red-400"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>Cancelar</span>
          </button>
        </div>
      </div>

      {/* Indicador de las 3 Fases */}
      <div className="grid grid-cols-3 gap-2">
        {steps.map((step) => {
          const isDone = activeStep > step.num;
          const isCurrent = activeStep === step.num;
          return (
            <div
              key={step.num}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                isDone
                  ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : isCurrent
                    ? 'border-blue-300 bg-blue-50/70 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-200'
                    : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400'
              }`}
            >
              {isDone && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Barra de progreso y telemetría en tiempo real */}
      {progress && (
        <div className="space-y-2">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-150 ${
                progress.phase === 'verifying'
                  ? 'bg-emerald-600 dark:bg-emerald-500'
                  : isPaused
                    ? 'bg-amber-500'
                    : 'bg-blue-600 dark:bg-blue-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
            <span>
              {formatPercent(progress.percent)} · {formatBytes(progress.bytesProcessed)} /{' '}
              {formatBytes(progress.totalBytes)}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {formatNumber(progress.filesCompleted)} / {formatNumber(progress.filesTotal)} archivos
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {formatSpeed(progress.speedBytesPerSec)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Restante: {formatEta(progress.etaSeconds)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <p className="min-w-0 truncate font-mono" title={progress.currentFile}>
              Archivo actual: {progress.currentFile}
            </p>
            {progress.retriesCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700 whitespace-nowrap shrink-0 dark:text-amber-300">
                <RotateCcw className="h-3 w-3" />
                <span>{progress.retriesCount} reintentos automáticos</span>
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
