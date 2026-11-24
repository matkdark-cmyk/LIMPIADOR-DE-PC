import { AlertTriangle, CheckCircle2, Clock, Database, Info, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  formatActionName,
  formatBytes,
  formatDateTime,
  formatModuleName,
} from '../../utils/formatters';

function StatusLabel({ status }: { status: string }) {
  if (status === 'ok' || status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Correcto</span>
      </span>
    );
  }
  if (status === 'warning' || status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Aviso</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>Registro</span>
    </span>
  );
}

export function RecentActivityPanel() {
  const isTauri = useAppStore((state) => state.isTauri);
  const appStatus = useAppStore((state) => state.appStatus);
  const auditLogs = useAppStore((state) => state.auditLogs);
  const isLoadingLogs = useAppStore((state) => state.isLoadingLogs);
  const refreshAuditLogs = useAppStore((state) => state.refreshAuditLogs);

  const visibleLogs = auditLogs.slice(0, 5);

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Actividad reciente
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Últimas 5 acciones guardadas en tu registro local de auditoría.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {appStatus && (
            <div
              title={`Base de datos SQLite: ${appStatus.dbPath}`}
              className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
            >
              <Database className="h-3.5 w-3.5 text-slate-400" />
              <span>{appStatus.isPortable ? 'Modo Portable' : 'Modo Instalado'}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  appStatus.dbConnected
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                {appStatus.dbConnected ? 'SQLite activo' : 'SQLite desconectado'}
              </span>
            </div>
          )}

          {isTauri && (
            <button
              type="button"
              disabled={isLoadingLogs}
              onClick={() => void refreshAuditLogs(5)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
              <span>Recargar</span>
            </button>
          )}
        </div>
      </div>

      {isLoadingLogs ? (
        <div className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {[1, 2, 3].map((row) => (
            <div key={row} className="flex items-center justify-between py-3.5">
              <div className="h-4 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
            </div>
          ))}
        </div>
      ) : visibleLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
          <Clock className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Aún no se han registrado acciones de limpieza o mantenimiento
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Cuando envíes archivos a la Papelera, muevas carpetas al NAS o ajustes preferencias, cada
            operación aparecerá aquí con fecha y espacio liberado.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-2.5 font-medium">Fecha</th>
                <th className="px-4 py-2.5 font-medium">Módulo</th>
                <th className="px-4 py-2.5 font-medium">Acción</th>
                <th className="px-4 py-2.5 font-medium">Detalle</th>
                <th className="px-4 py-2.5 text-right font-medium">Espacio</th>
                <th className="px-6 py-2.5 text-right font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleLogs.map((entry) => (
                <tr
                  key={entry.id}
                  className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <td className="px-6 py-3 font-mono tabular-nums whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {formatDateTime(entry.timestamp)}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-slate-800 dark:text-slate-200">
                    {formatModuleName(entry.module)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {formatActionName(entry.action)}
                  </td>
                  <td
                    className="max-w-xs truncate px-4 py-3 text-slate-600 dark:text-slate-400"
                    title={entry.details ?? undefined}
                  >
                    {entry.details ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {entry.bytesAffected > 0 ? formatBytes(entry.bytesAffected) : '—'}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <StatusLabel status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
