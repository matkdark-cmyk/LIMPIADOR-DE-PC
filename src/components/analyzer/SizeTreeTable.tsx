import {
  ArrowUp,
  ChevronRight,
  File as FileIcon,
  Folder,
  Lock,
  Search,
} from 'lucide-react';
import { useMemo } from 'react';
import { useScannerStore } from '../../store/useScannerStore';
import {
  buildPathBreadcrumbs,
  formatBytes,
  formatNumber,
  formatPercent,
  SECTION_VISUALS,
} from '../../utils/format';
import { RowQuickActions } from './RowQuickActions';

export function SizeTreeTable() {
  const scanSummary = useScannerStore((state) => state.scanSummary);
  const currentFolderPath = useScannerStore((state) => state.currentFolderPath);
  const currentFolderChildren = useScannerStore((state) => state.currentFolderChildren);
  const isLoadingChildren = useScannerStore((state) => state.isLoadingChildren);
  const searchQuery = useScannerStore((state) => state.searchQuery);
  const setSearchQuery = useScannerStore((state) => state.setSearchQuery);
  const openFolder = useScannerStore((state) => state.openFolder);
  const goUpFolder = useScannerStore((state) => state.goUpFolder);

  const breadcrumbs = useMemo(() => {
    if (!scanSummary) {
      return [];
    }
    return buildPathBreadcrumbs(currentFolderPath, scanSummary.rootPath);
  }, [currentFolderPath, scanSummary]);

  const canGoUp = breadcrumbs.length > 1;

  const filteredChildren = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return currentFolderChildren;
    }
    return currentFolderChildren.filter((item) =>
      item.name.toLowerCase().includes(q),
    );
  }, [currentFolderChildren, searchQuery]);

  if (!scanSummary) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Barra de navegación Breadcrumb + Subir nivel + Buscador local */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            disabled={!canGoUp || isLoadingChildren}
            onClick={() => void goUpFolder()}
            title="Subir un nivel de carpeta"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span>Subir nivel</span>
          </button>

          <nav
            aria-label="Ubicación actual"
            className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950/60"
          >
            {breadcrumbs.map((segment, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <div key={segment.path} className="flex shrink-0 items-center gap-1">
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600" />
                  )}
                  <button
                    type="button"
                    disabled={isLast || isLoadingChildren}
                    onClick={() => void openFolder(segment.path)}
                    className={`rounded px-1 py-0.5 font-mono transition-colors ${
                      isLast
                        ? 'font-semibold text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    }`}
                  >
                    {segment.label}
                  </button>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="relative w-full shrink-0 sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filtrar en esta carpeta..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Tabla ordenada estrictamente de mayor a menor tamaño */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {isLoadingChildren ? (
          <div className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="flex items-center justify-between py-3">
                <div className="h-4 w-60 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              </div>
            ))}
          </div>
        ) : filteredChildren.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {searchQuery.trim()
                ? 'Ningún elemento coincide con tu búsqueda en esta carpeta.'
                : 'Esta carpeta está vacía o sus archivos requieren permisos adicionales.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-3 font-medium">Nombre</th>
                  <th className="w-40 px-4 py-3 font-medium">Proporción</th>
                  <th className="px-4 py-3 text-right font-medium">Tamaño</th>
                  <th className="px-4 py-3 text-right font-medium">% Carpeta</th>
                  <th className="px-4 py-3 font-medium">Sección</th>
                  <th className="px-5 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredChildren.map((node) => {
                  const visual = SECTION_VISUALS[node.section];
                  const barWidth = Math.min(100, Math.max(node.sizeBytes > 0 ? 1.5 : 0, node.percentOfParent));

                  return (
                    <tr
                      key={node.path}
                      onClick={() => {
                        if (node.isDir) {
                          void openFolder(node.path);
                        }
                      }}
                      className={`transition-colors ${
                        node.isDir
                          ? 'cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-500/10'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="max-w-md px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {node.isDir ? (
                            <Folder className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <FileIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`truncate font-medium ${
                                  node.isDir
                                    ? 'text-slate-900 dark:text-slate-100'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                                title={node.path}
                              >
                                {node.name}
                              </span>
                              {node.isProtected && (
                                <span
                                  title="Ruta protegida del sistema operativo Windows"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 whitespace-nowrap shrink-0 dark:text-red-400"
                                >
                                  <Lock className="h-3 w-3" />
                                  <span>Protegido</span>
                                </span>
                              )}
                            </div>
                            {node.isDir && (
                              <span className="block text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                                {formatNumber(node.fileCount)} archivos
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: node.isProtected ? '#DC2626' : visual.barColor,
                            }}
                          />
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
                        {formatBytes(node.sizeBytes)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {formatPercent(node.percentOfParent)}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {visual.shortLabel}
                      </td>

                      <td className="px-5 py-3 whitespace-nowrap">
                        <RowQuickActions node={node} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
