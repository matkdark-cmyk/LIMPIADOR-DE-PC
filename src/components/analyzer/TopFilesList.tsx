import { File as FileIcon, Lock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useScannerStore } from '../../store/useScannerStore';
import type { FileNode, FileSection } from '../../types';
import {
  formatBytes,
  formatPercent,
  getRelativeDisplayPath,
  SECTION_VISUALS,
} from '../../utils/format';
import { RowQuickActions } from './RowQuickActions';

interface TopFilesListProps {
  mode: 'top-files' | 'sections';
}

export function TopFilesList({ mode }: TopFilesListProps) {
  const scanSummary = useScannerStore((state) => state.scanSummary);
  const selectedSection = useScannerStore((state) => state.selectedSection);
  const sectionFiles = useScannerStore((state) => state.sectionFiles);
  const isLoadingSectionFiles = useScannerStore((state) => state.isLoadingSectionFiles);
  const selectSection = useScannerStore((state) => state.selectSection);

  const [filterText, setFilterText] = useState('');

  const sourceList: FileNode[] = useMemo(() => {
    if (!scanSummary) {
      return [];
    }
    return mode === 'top-files' ? scanSummary.topFiles : sectionFiles;
  }, [mode, scanSummary, sectionFiles]);

  const filteredList = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) {
      return sourceList;
    }
    return sourceList.filter(
      (item) =>
        item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
    );
  }, [sourceList, filterText]);

  if (!scanSummary) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {mode === 'sections' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {scanSummary.sections.map((sec) => {
              const visual = SECTION_VISUALS[sec.section];
              const isActive = sec.section === selectedSection;
              return (
                <button
                  key={sec.section}
                  type="button"
                  onClick={() => void selectSection(sec.section as FileSection, false)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {visual.shortLabel} ({formatBytes(sec.totalBytes)})
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mostrando los {filteredList.length} archivos individuales más pesados encontrados en{' '}
            <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
              {scanSummary.rootPath}
            </span>
            .
          </p>
        )}

        <div className="relative w-full shrink-0 sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Buscar archivo o carpeta..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {mode === 'sections' && isLoadingSectionFiles ? (
          <div className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="flex items-center justify-between py-3">
                <div className="h-4 w-72 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              </div>
            ))}
          </div>
        ) : filteredList.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {filterText.trim()
                ? 'No se encontraron archivos que coincidan con tu filtro.'
                : 'No se encontraron archivos con peso relevante en esta categoría.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="w-12 px-5 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Archivo y ubicación</th>
                  <th className="px-4 py-3 font-medium">Sección</th>
                  <th className="px-4 py-3 text-right font-medium">Tamaño</th>
                  <th className="px-4 py-3 text-right font-medium">% Escaneo</th>
                  <th className="px-5 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredList.map((file, index) => {
                  const visual = SECTION_VISUALS[file.section];
                  const relativePath = getRelativeDisplayPath(file.path, scanSummary.rootPath);

                  return (
                    <tr
                      key={file.path}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-3 font-mono tabular-nums text-slate-400 dark:text-slate-500">
                        {index + 1}
                      </td>

                      <td className="max-w-lg px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="truncate font-semibold text-slate-900 dark:text-slate-100"
                                title={file.name}
                              >
                                {file.name}
                              </span>
                              {file.isProtected && (
                                <span
                                  title="Ruta protegida del sistema operativo Windows"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 whitespace-nowrap shrink-0 dark:text-red-400"
                                >
                                  <Lock className="h-3 w-3" />
                                  <span>Protegido</span>
                                </span>
                              )}
                            </div>
                            <p
                              className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
                              title={file.path}
                            >
                              {relativePath}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {visual.shortLabel}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
                        {formatBytes(file.sizeBytes)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {formatPercent(file.percentOfScan)}
                      </td>

                      <td className="px-5 py-3 whitespace-nowrap">
                        <RowQuickActions node={file} />
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
