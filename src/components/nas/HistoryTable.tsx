import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderOpen,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useNasStore } from '../../store/useNasStore';
import { useScannerStore } from '../../store/useScannerStore';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTransferMode,
} from '../../utils/formatters';

function TransferStatusBadge({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage: string | null;
}) {
  if (status === 'verified_completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Verificado xxHash3</span>
      </span>
    );
  }
  if (status === 'completed_unverified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap dark:text-blue-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Completado (sin Paso 2)</span>
      </span>
    );
  }
  if (status === 'cancelled_source_intact') {
    return (
      <span
        title={errorMessage ?? undefined}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap dark:text-amber-300"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Cancelado · Origen intacto</span>
      </span>
    );
  }
  return (
    <span
      title={errorMessage ?? undefined}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap dark:text-red-400"
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Detenido · Origen intacto</span>
    </span>
  );
}

export function HistoryTable() {
  const history = useNasStore((state) => state.history);
  const isLoadingHistory = useNasStore((state) => state.isLoadingHistory);
  const loadTargetsAndHistory = useNasStore((state) => state.loadTargetsAndHistory);
  const openInExplorer = useScannerStore((state) => state.openInExplorer);

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Historial de migraciones al NAS
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Registro auditable en SQLite de cada transferencia, su verificación xxHash3 y estado final.
          </p>
        </div>

        <button
          type="button"
          disabled={isLoadingHistory}
          onClick={() => void loadTargetsAndHistory()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
          <span>Recargar</span>
        </button>
      </div>

      {isLoadingHistory ? (
        <div className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {[1, 2, 3].map((row) => (
            <div key={row} className="flex items-center justify-between py-4">
              <div className="h-4 w-72 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
            </div>
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <Clock className="h-6 w-6 text-slate-400 dark:text-slate-500" />
          <p className="mt-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            Aún no hay migraciones registradas
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Cuando traslades una carpeta hacia tu NAS o a otro disco, aquí aparecerá el detalle
            completo con fecha, tamaño y confirmación xxHash3.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Origen y destino</th>
                <th className="px-4 py-3 font-medium">Modo</th>
                <th className="px-4 py-3 text-right font-medium">Volumen</th>
                <th className="px-4 py-3 text-right font-medium">Duración</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 text-right font-medium">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((item) => (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <td className="px-6 py-3 font-mono tabular-nums whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {formatDateTime(item.timestamp)}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <p
                      className="truncate font-mono text-[11px] text-slate-800 dark:text-slate-200"
                      title={item.sourcePath}
                    >
                      {item.sourcePath}
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
                      title={item.destPath}
                    >
                      → {item.destPath}
                    </p>
                    {item.errorMessage && (
                      <p
                        className="mt-1 truncate text-[11px] text-amber-700 dark:text-amber-300"
                        title={item.errorMessage}
                      >
                        {item.errorMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {formatTransferMode(item.mode)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
                    <span className="font-semibold">{formatBytes(item.totalBytes)}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      {formatNumber(item.filesCount)} archivos
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                    {formatDuration(item.durationMs)}
                  </td>
                  <td className="px-4 py-3">
                    <TransferStatusBadge
                      status={item.status}
                      errorMessage={item.errorMessage}
                    />
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    {item.status === 'verified_completed' ||
                    item.status === 'completed_unverified' ? (
                      <button
                        type="button"
                        onClick={() => void openInExplorer(item.destPath)}
                        title="Abrir destino en el Explorador de Windows"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
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
