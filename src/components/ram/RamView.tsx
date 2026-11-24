import { useEffect } from 'react';
import {
  CheckCircle2,
  Cpu,
  HelpCircle,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useRamStore } from '../../store/useRamStore';
import { formatBytes } from '../../utils/format';
import { GroupedProcessTable } from './GroupedProcessTable';
import { RamLiveChart } from './RamLiveChart';

const AUTO_THRESHOLDS = [80, 85, 90] as const;
const SIGNIFICANT_FREED_BYTES = 25 * 1024 * 1024; // 25 MiB

function getUsageTone(percent: number): {
  textClass: string;
  barClass: string;
  statusLabel: string;
} {
  if (percent >= 85) {
    return {
      textClass: 'text-red-600 dark:text-red-400',
      barClass: 'bg-red-600 dark:bg-red-500',
      statusLabel: 'Consumo elevado',
    };
  }
  if (percent >= 70) {
    return {
      textClass: 'text-amber-600 dark:text-amber-400',
      barClass: 'bg-amber-500 dark:bg-amber-400',
      statusLabel: 'Consumo moderado',
    };
  }
  return {
    textClass: 'text-blue-600 dark:text-blue-400',
    barClass: 'bg-blue-600 dark:bg-blue-500',
    statusLabel: 'Estado saludable',
  };
}

export function RamView() {
  const isTauri = useAppStore((s) => s.isTauri);
  const isElevating = useAppStore((s) => s.isElevating);
  const requestAdminElevation = useAppStore((s) => s.requestAdminElevation);

  const snapshot = useRamStore((s) => s.snapshot);
  const history = useRamStore((s) => s.history);
  const isLoading = useRamStore((s) => s.isLoading);
  const isPaused = useRamStore((s) => s.isPaused);
  const isOptimizing = useRamStore((s) => s.isOptimizing);
  const purgeStandby = useRamStore((s) => s.purgeStandby);
  const lastOptimizeResult = useRamStore((s) => s.lastOptimizeResult);
  const autoConfig = useRamStore((s) => s.autoConfig);
  const isSavingAutoConfig = useRamStore((s) => s.isSavingAutoConfig);

  const fetchSnapshot = useRamStore((s) => s.fetchSnapshot);
  const loadAutoConfig = useRamStore((s) => s.loadAutoConfig);
  const updateAutoConfig = useRamStore((s) => s.updateAutoConfig);
  const togglePaused = useRamStore((s) => s.togglePaused);
  const setPurgeStandby = useRamStore((s) => s.setPurgeStandby);
  const runOptimize = useRamStore((s) => s.runOptimize);
  const clearLastOptimizeResult = useRamStore((s) => s.clearLastOptimizeResult);

  // Cargar regla persistida de auto-optimización al entrar a la vista
  useEffect(() => {
    if (!isTauri) {
      return;
    }
    void loadAutoConfig();
  }, [isTauri, loadAutoConfig]);

  // Polling estrictamente acotado al ciclo de vida de RamView (cada 2s mientras no esté en pausa)
  useEffect(() => {
    if (!isTauri) {
      return;
    }

    void fetchSnapshot({ silent: false });

    if (isPaused) {
      return;
    }

    const timerId = window.setInterval(() => {
      void fetchSnapshot({ silent: true });
    }, 2000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isTauri, isPaused, fetchSnapshot]);

  if (!isTauri) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Monitor en Tiempo Real y Liberador de Memoria RAM
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Supervisa tu memoria RAM en vivo cada 2 segundos, visualiza las aplicaciones
                agrupadas de mayor a menor consumo y libera memoria retenida en 1 clic
                (Working Set + Standby List en Modo Administrador).
              </p>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Ejecuta{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  npm run tauri dev
                </code>{' '}
                en tu PC con Windows para monitorear y optimizar tu memoria real.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const metrics = snapshot?.metrics ?? null;
  const isAdmin = snapshot?.isAdmin ?? false;
  const usagePercent = metrics ? metrics.usagePercent : 0;
  const tone = getUsageTone(usagePercent);

  const totalRecovered = lastOptimizeResult
    ? lastOptimizeResult.freedBytes + lastOptimizeResult.standbyFreedBytes
    : 0;
  const hasSignificantGain = totalRecovered >= SIGNIFICANT_FREED_BYTES;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 1. PANEL SUPERIOR (2 COLUMNAS) */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Izquierda: Indicador principal + Gráfica en tiempo real + 4 métricas */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          {/* Encabezado de consumo actual */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Uso actual de memoria RAM · {tone.statusLabel}
              </p>
              <div className="mt-1 flex items-baseline gap-3">
                <span
                  className={`font-mono text-4xl font-bold tracking-tight tabular-nums ${tone.textClass}`}
                >
                  {isLoading && !metrics ? '—' : `${Math.round(usagePercent)}%`}
                </span>
                {metrics && (
                  <span className="font-mono text-sm tabular-nums text-slate-600 dark:text-slate-300">
                    {formatBytes(metrics.usedBytes)} / {formatBytes(metrics.totalBytes)}
                  </span>
                )}
              </div>
            </div>

            {metrics && (
              <div className="text-right">
                <p className="text-xs text-slate-500 dark:text-slate-400">Disponible ahora</p>
                <p className="font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatBytes(metrics.availableBytes)}
                </p>
              </div>
            )}
          </div>

          {/* Barra de uso total */}
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${tone.barClass}`}
              style={{ width: `${Math.min(100, Math.max(0, usagePercent))}%` }}
            />
          </div>

          {/* Gráfica en vivo (separada por línea sutil, sin tarjetas anidadas) */}
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <RamLiveChart
              history={history}
              currentPercent={usagePercent}
              isPaused={isPaused}
              onTogglePause={togglePaused}
            />
          </div>

          {/* 4 métricas explicadas con tooltips claros */}
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4 dark:border-slate-800">
            <div
              title="Memoria física que están usando activamente Windows y tus aplicaciones abiertas."
              className="space-y-0.5"
            >
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>En uso</span>
                <HelpCircle className="h-3 w-3 opacity-60" />
              </div>
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {metrics ? formatBytes(metrics.usedBytes) : '—'}
              </p>
            </div>

            <div
              title="Memoria lista para usar de inmediato por nuevos programas (incluye memoria libre y caché reutilizable)."
              className="space-y-0.5"
            >
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>Disponible</span>
                <HelpCircle className="h-3 w-3 opacity-60" />
              </div>
              <p className="font-mono text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {metrics ? formatBytes(metrics.availableBytes) : '—'}
              </p>
            </div>

            <div
              title="Memoria que Windows mantiene precargada (Standby) para reabrir rápido programas cerrados recientemente."
              className="space-y-0.5"
            >
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>En caché (Standby)</span>
                <HelpCircle className="h-3 w-3 opacity-60" />
              </div>
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {metrics ? formatBytes(metrics.cachedStandbyBytes) : '—'}
              </p>
            </div>

            <div
              title="Memoria virtual total reservada por el sistema (RAM física + archivo de paginación en disco)."
              className="space-y-0.5"
            >
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>Comprometida</span>
                <HelpCircle className="h-3 w-3 opacity-60" />
              </div>
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {metrics ? formatBytes(metrics.commitUsedBytes) : '—'}
              </p>
              {metrics && metrics.commitLimitBytes > 0 && (
                <p className="font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                  de {formatBytes(metrics.commitLimitBytes)}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Derecha: Tarjeta de Acción "Liberar RAM" */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Liberar Memoria RAM
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Pide de forma segura a tus aplicaciones abiertas que devuelvan la memoria inactiva
                sin cerrar tus ventanas ni perder tu trabajo.
              </p>
            </div>

            {/* Botón principal de 1 clic */}
            <button
              type="button"
              onClick={() => void runOptimize()}
              disabled={isOptimizing || !metrics}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Optimizando memoria...
                </>
              ) : (
                <>
                  <Zap className="h-5 w-5" />
                  Liberar RAM Ahora
                </>
              )}
            </button>

            {/* Opción de Standby List */}
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <label
                className={`flex items-start gap-3 ${
                  isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isAdmin && purgeStandby}
                  disabled={!isAdmin || isOptimizing}
                  onChange={(e) => setPurgeStandby(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-800"
                />
                <div className="space-y-1">
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Limpiar también caché en espera (Standby List)
                  </span>
                  <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Libera memoria que Windows guarda precargada de programas cerrados.
                  </span>
                </div>
              </label>

              {!isAdmin && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    Requiere permisos de Administrador.
                  </span>
                  <button
                    type="button"
                    onClick={() => void requestAdminElevation()}
                    disabled={isElevating}
                    className="shrink-0 font-semibold text-amber-900 underline decoration-amber-500/60 underline-offset-2 transition-colors hover:text-amber-700 disabled:opacity-50 dark:text-amber-100 dark:hover:text-white"
                  >
                    {isElevating ? 'Abriendo UAC...' : 'Activar Modo Administrador'}
                  </button>
                </div>
              )}
            </div>

            {/* Resultado inmediato y honesto tras optimizar */}
            {lastOptimizeResult && (
              <div
                className={`relative rounded-lg border px-4 py-3 text-sm ${
                  hasSignificantGain
                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100'
                    : 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={clearLastOptimizeResult}
                  aria-label="Ocultar resultado"
                  className="absolute top-2.5 right-2.5 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex items-start gap-2.5 pr-6">
                  {hasSignificantGain ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  )}
                  <div className="space-y-1">
                    {hasSignificantGain ? (
                      <p className="font-semibold">
                        ¡Listo! Se liberaron {formatBytes(totalRecovered)} (uso bajó de{' '}
                        <span className="font-mono tabular-nums">
                          {Math.round(lastOptimizeResult.before.usagePercent)}%
                        </span>{' '}
                        a{' '}
                        <span className="font-mono tabular-nums">
                          {Math.round(lastOptimizeResult.after.usagePercent)}%
                        </span>
                        )
                      </p>
                    ) : (
                      <p className="font-medium">
                        Tu memoria ya estaba bien optimizada
                        {totalRecovered > 0
                          ? ` (se recuperaron ${formatBytes(totalRecovered)})`
                          : ''}
                      </p>
                    )}

                    <p className="text-xs opacity-80">
                      {lastOptimizeResult.processesTrimmed} procesos optimizados
                      {lastOptimizeResult.standbyPurged
                        ? ` · Standby List purgada (${formatBytes(lastOptimizeResult.standbyFreedBytes)})`
                        : ''}
                      {' · '}
                      {lastOptimizeResult.durationMs} ms
                    </p>

                    {lastOptimizeResult.note && (
                      <p className="text-xs opacity-90">{lastOptimizeResult.note}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Los procesos esenciales de Windows y DiskVault Clean se excluyen automáticamente por
            seguridad.
          </p>
        </section>
      </div>

      {/* 2. BARRA COMPACTA DE AUTO-OPTIMIZACIÓN */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={autoConfig.enabled}
              disabled={isSavingAutoConfig}
              onClick={() => void updateAutoConfig({ enabled: !autoConfig.enabled })}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                autoConfig.enabled
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  autoConfig.enabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Liberar RAM automáticamente si el uso supera:
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Solo actúa como máximo una vez cada {autoConfig.cooldownMinutes} minutos para no
                afectar tu rendimiento ni juegos.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pl-12 lg:pl-0">
            {/* Selector de umbral (80%, 85%, 90%) */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950">
              {AUTO_THRESHOLDS.map((value) => {
                const isActive = autoConfig.thresholdPercent === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={isSavingAutoConfig}
                    onClick={() => void updateAutoConfig({ thresholdPercent: value })}
                    className={`rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-800 dark:text-blue-400'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {value}%
                  </button>
                );
              })}
            </div>

            {isAdmin && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 select-none dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={autoConfig.purgeStandby}
                  disabled={isSavingAutoConfig}
                  onChange={(e) => void updateAutoConfig({ purgeStandby: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
                />
                Incluir Standby List
              </label>
            )}
          </div>
        </div>
      </section>

      {/* 3. TABLA DE PROCESOS AGRUPADOS */}
      <GroupedProcessTable />
    </div>
  );
}
