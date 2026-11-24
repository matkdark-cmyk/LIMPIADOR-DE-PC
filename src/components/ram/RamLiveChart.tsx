import { Pause, Play } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RamHistoryPoint } from '../../types';

interface RamLiveChartProps {
  history: RamHistoryPoint[];
  currentPercent: number;
  isPaused: boolean;
  onTogglePause: () => void;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: RamHistoryPoint;
  }>;
}

function getStrokePalette(percent: number): { stroke: string; fillId: string; stopColor: string } {
  if (percent >= 85) {
    return { stroke: '#DC2626', fillId: 'ramFillDanger', stopColor: '#DC2626' };
  }
  if (percent >= 70) {
    return { stroke: '#D97706', fillId: 'ramFillWarn', stopColor: '#D97706' };
  }
  return { stroke: '#2563EB', fillId: 'ramFillNormal', stopColor: '#2563EB' };
}

function CustomRamTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
        {point.timeLabel}
      </p>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 dark:text-slate-300">Uso total</span>
          <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {point.usagePercent.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 dark:text-slate-300">En uso</span>
          <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
            {point.usedGb.toFixed(2)} GB
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 dark:text-slate-300">Disponible</span>
          <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
            {point.availableGb.toFixed(2)} GB
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 dark:text-slate-300">En caché</span>
          <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
            {point.standbyGb.toFixed(2)} GB
          </span>
        </div>
      </div>
    </div>
  );
}

export function RamLiveChart({
  history,
  currentPercent,
  isPaused,
  onTogglePause,
}: RamLiveChartProps) {
  const palette = getStrokePalette(currentPercent);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Historial en tiempo real (últimos 2 minutos)
          {isPaused ? ' · En pausa' : ''}
        </span>

        <button
          type="button"
          onClick={onTogglePause}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {isPaused ? (
            <>
              <Play className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Reanudar monitor
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              Pausar monitor
            </>
          )}
        </button>
      </div>

      <div className="h-44 w-full">
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Recopilando primeras lecturas de memoria...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id={palette.fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette.stopColor} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={palette.stopColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
              />
              <XAxis
                dataKey="timeLabel"
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                tickLine={false}
                axisLine={false}
                minTickGap={36}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(val: number) => `${val}%`}
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomRamTooltip />} />
              <Area
                type="monotone"
                dataKey="usagePercent"
                stroke={palette.stroke}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#${palette.fillId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
