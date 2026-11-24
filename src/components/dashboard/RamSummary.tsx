import { ArrowRight, MemoryStick } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useAppStore } from '../../store/useAppStore';
import { useScannerStore } from '../../store/useScannerStore';
import { formatBytes, formatPercent } from '../../utils/format';

export function RamSummary() {
  const isTauri = useAppStore((state) => state.isTauri);
  const setActiveRoute = useAppStore((state) => state.setActiveRoute);
  const theme = useAppStore((state) => state.theme);
  const systemOverview = useScannerStore((state) => state.systemOverview);
  const isLoadingOverview = useScannerStore((state) => state.isLoadingOverview);

  const ram = systemOverview?.ram ?? null;
  const usagePercent = ram ? Math.min(100, Math.max(0, ram.usagePercent)) : 0;

  const gaugeColor =
    usagePercent >= 88
      ? '#DC2626'
      : usagePercent >= 75
        ? '#D97706'
        : '#2563EB';
  const trackColor = theme === 'dark' ? '#1E293B' : '#E2E8F0';

  const chartData = [
    { name: 'Usada', value: usagePercent },
    { name: 'Disponible', value: Math.max(0, 100 - usagePercent) },
  ];

  return (
    <section
      aria-label="Resumen de memoria RAM"
      className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Memoria RAM
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Uso actual del sistema
            </p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <MemoryStick className="h-4 w-4" />
          </div>
        </div>

        {!isTauri ? (
          <div className="my-8 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Medidor en vivo en Windows
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Al ejecutar la aplicación nativa verás la memoria RAM usada y disponible en tiempo real.
            </p>
          </div>
        ) : isLoadingOverview && !ram ? (
          <div className="my-6 flex flex-col items-center gap-3">
            <div className="h-36 w-36 animate-pulse rounded-full border-[14px] border-slate-100 dark:border-slate-800" />
            <div className="h-4 w-36 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ) : ram ? (
          <>
            <div className="relative mx-auto my-3 h-40 w-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    startAngle={90}
                    endAngle={-270}
                    innerRadius={54}
                    outerRadius={70}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    <Cell fill={gaugeColor} />
                    <Cell fill={trackColor} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatPercent(ram.usagePercent)}
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  en uso
                </span>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3.5 text-xs dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">RAM utilizada</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatBytes(ram.usedBytes)} / {formatBytes(ram.totalBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Disponible</span>
                <span className="font-mono font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatBytes(ram.availableBytes)}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveRoute('ram')}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <span>Ir a Memoria RAM</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>
    </section>
  );
}
