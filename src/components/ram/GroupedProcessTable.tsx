import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Power,
  RefreshCw,
  Search,
  Shield,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useRamStore } from '../../store/useRamStore';
import type { GroupedAppProcess } from '../../types';
import { formatBytes } from '../../utils/format';

function getBarColorClass(percent: number): string {
  if (percent >= 25) {
    return 'bg-red-500 dark:bg-red-500';
  }
  if (percent >= 12) {
    return 'bg-amber-500 dark:bg-amber-500';
  }
  return 'bg-blue-600 dark:bg-blue-500';
}

export function GroupedProcessTable() {
  const snapshot = useRamStore((s) => s.snapshot);
  const isFetching = useRamStore((s) => s.isFetching);
  const searchQuery = useRamStore((s) => s.searchQuery);
  const hideSystemProcesses = useRamStore((s) => s.hideSystemProcesses);
  const closingGroup = useRamStore((s) => s.closingGroup);
  const isClosingGroup = useRamStore((s) => s.isClosingGroup);

  const fetchSnapshot = useRamStore((s) => s.fetchSnapshot);
  const setSearchQuery = useRamStore((s) => s.setSearchQuery);
  const setHideSystemProcesses = useRamStore((s) => s.setHideSystemProcesses);
  const openCloseGroupModal = useRamStore((s) => s.openCloseGroupModal);
  const closeCloseGroupModal = useRamStore((s) => s.closeCloseGroupModal);
  const confirmCloseGroup = useRamStore((s) => s.confirmCloseGroup);

  useEscapeKey(Boolean(closingGroup), closeCloseGroupModal, isClosingGroup);

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleExpand = (groupKey: string) => {
    setExpandedKeys((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const { visibleProcesses, hiddenSystemCount } = useMemo(() => {
    const all = snapshot?.processes ?? [];
    const normalizedQuery = searchQuery.trim().toLowerCase();
    let hiddenCount = 0;

    const filtered: GroupedAppProcess[] = [];
    for (const proc of all) {
      if (hideSystemProcesses && proc.isSystemCritical) {
        hiddenCount += 1;
        continue;
      }
      if (normalizedQuery.length > 0) {
        const matchDisplay = proc.displayName.toLowerCase().includes(normalizedQuery);
        const matchKey = proc.groupKey.toLowerCase().includes(normalizedQuery);
        if (!matchDisplay && !matchKey) {
          continue;
        }
      }
      filtered.push(proc);
    }

    return {
      visibleProcesses: filtered,
      hiddenSystemCount: hiddenCount,
    };
  }, [snapshot, searchQuery, hideSystemProcesses]);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Cabecera y controles */}
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Aplicaciones que más memoria consumen
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Agrupadas por programa y ordenadas de mayor a menor consumo real.
              {hiddenSystemCount > 0
                ? ` (${hiddenSystemCount} procesos del sistema ocultos)`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Buscador instantáneo */}
            <div className="relative min-w-[210px] flex-1 sm:flex-initial">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar aplicación..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:bg-slate-900"
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Switch: Ocultar procesos del sistema */}
            <label className="inline-flex cursor-pointer items-center gap-2 select-none">
              <button
                type="button"
                role="switch"
                aria-checked={hideSystemProcesses}
                onClick={() => setHideSystemProcesses(!hideSystemProcesses)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  hideSystemProcesses
                    ? 'bg-blue-600 dark:bg-blue-500'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    hideSystemProcesses ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Ocultar procesos del sistema
              </span>
            </label>

            {/* Botón refrescar ahora */}
            <button
              type="button"
              onClick={() => void fetchSnapshot()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Tabla principal */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="py-2.5 pr-3 pl-5">Aplicación</th>
                <th className="w-44 px-3 py-2.5">Impacto visual</th>
                <th className="w-32 px-3 py-2.5 text-right">Memoria</th>
                <th className="w-20 px-3 py-2.5 text-right">% RAM</th>
                <th className="w-36 py-2.5 pr-5 pl-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {visibleProcesses.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {searchQuery.trim().length > 0
                      ? `No se encontraron aplicaciones que coincidan con "${searchQuery}".`
                      : 'Sin procesos activos para mostrar en este momento.'}
                  </td>
                </tr>
              ) : (
                visibleProcesses.map((group) => {
                  const hasMultiple = group.processCount > 1;
                  const isExpanded = Boolean(expandedKeys[group.groupKey]);
                  const barWidth = Math.min(100, Math.max(1.5, group.percentOfRam));

                  return (
                    <Fragment key={group.groupKey}>
                      <tr className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        {/* Nombre + chevron + conteo de subprocesos */}
                        <td className="py-3 pr-3 pl-5">
                          <div className="flex items-center gap-2.5">
                            {hasMultiple ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(group.groupKey)}
                                aria-label={
                                  isExpanded
                                    ? `Ocultar subprocesos de ${group.displayName}`
                                    : `Ver subprocesos de ${group.displayName}`
                                }
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            ) : (
                              <span className="h-6 w-6 shrink-0" />
                            )}

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span
                                  className="truncate font-medium text-slate-900 dark:text-slate-100"
                                  title={group.exePath ?? group.groupKey}
                                >
                                  {group.displayName}
                                </span>
                                {hasMultiple && (
                                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                                    ({group.processCount} procesos)
                                  </span>
                                )}
                                {group.isSystemCritical && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                                    <Shield className="h-3 w-3" />
                                    Sistema
                                  </span>
                                )}
                                {group.isSelf && (
                                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                    Esta app
                                  </span>
                                )}
                              </div>
                              {group.exePath && (
                                <p
                                  className="max-w-md truncate font-mono text-[11px] text-slate-400 dark:text-slate-500"
                                  title={group.exePath}
                                >
                                  {group.exePath}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Barra proporcional */}
                        <td className="px-3 py-3">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${getBarColorClass(group.percentOfRam)}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </td>

                        {/* Memoria formateada */}
                        <td className="px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatBytes(group.totalMemoryBytes)}
                        </td>

                        {/* Porcentaje */}
                        <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {group.percentOfRam.toFixed(1)}%
                        </td>

                        {/* Acción */}
                        <td className="py-3 pr-5 pl-3 text-right">
                          {group.isSystemCritical || group.isSelf ? (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500"
                              title={
                                group.isSelf
                                  ? 'DiskVault Clean está protegido para no cerrarse a sí mismo.'
                                  : 'Proceso esencial de Windows protegido contra cierre accidental.'
                              }
                            >
                              <Lock className="h-3.5 w-3.5" />
                              Protegido
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openCloseGroupModal(group)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/60 dark:hover:text-red-300"
                            >
                              <Power className="h-3.5 w-3.5" />
                              Cerrar app
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Subprocesos desplegables */}
                      {hasMultiple && isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-950/50">
                          <td colSpan={5} className="py-2 pr-5 pl-14">
                            <div className="divide-y divide-slate-200/70 border-l border-slate-200 pl-4 dark:divide-slate-800 dark:border-slate-700">
                              {group.children.map((child) => (
                                <div
                                  key={child.pid}
                                  className="flex items-center justify-between py-1.5 text-xs"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono text-slate-700 dark:text-slate-300">
                                      {child.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                                      PID {child.pid}
                                    </span>
                                  </div>
                                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    {formatBytes(child.memoryBytes)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal de confirmación amigable para cerrar aplicación */}
      {closingGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-app-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="close-app-modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  ¿Cerrar {closingGroup.displayName}
                  {closingGroup.processCount > 1
                    ? ` (${closingGroup.processCount} procesos)`
                    : ''}
                  ?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Asegúrate de haber guardado tu trabajo antes de cerrarla. Esto liberará
                  aproximadamente{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatBytes(closingGroup.totalMemoryBytes)}
                  </span>{' '}
                  de memoria RAM.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={closeCloseGroupModal}
                disabled={isClosingGroup}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseGroup()}
                disabled={isClosingGroup}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {isClosingGroup ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cerrando...
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    Cerrar aplicación
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
