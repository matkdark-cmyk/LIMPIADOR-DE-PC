import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Globe,
  Layers,
  Loader2,
  Lock,
  Monitor,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { CacheGroup, CacheTarget } from '../../types';
import { formatBytes, formatNumber } from '../../utils/format';

interface CacheGroupSectionProps {
  group: CacheGroup;
  targets: CacheTarget[];
  isAdmin: boolean;
  selectedIds: Record<string, boolean>;
  closingTargetId: string | null;
  isCleaning: boolean;
  onToggleTarget: (id: string) => void;
  onCloseBlockingApps: (targetId: string, processNames: string[]) => void;
}

const GROUP_META: Record<
  CacheGroup,
  { title: string; subtitle: string; icon: typeof Monitor }
> = {
  windows_system: {
    title: 'Sistema Windows',
    subtitle: 'Temporales, descargas de Windows Update, optimización de entrega y miniaturas.',
    icon: Monitor,
  },
  browsers: {
    title: 'Navegadores Web',
    subtitle: 'Solo archivos de caché temporal. Nunca borra contraseñas, sesiones ni favoritos.',
    icon: Globe,
  },
  graphics_shaders: {
    title: 'Caché de Shaders Gráficos',
    subtitle: 'Shaders compilados por DirectX, NVIDIA, AMD o Intel que se regeneran al jugar.',
    icon: Cpu,
  },
  inactive_apps: {
    title: 'Aplicaciones y Apps sin Uso',
    subtitle: 'Cachés acumuladas por apps de comunicación, edición y tiendas de juegos.',
    icon: Layers,
  },
  recycle_bin: {
    title: 'Papelera de Reciclaje',
    subtitle: 'Elementos eliminados previamente que aún ocupan espacio en tus unidades.',
    icon: Trash2,
  },
};

export function CacheGroupSection({
  group,
  targets,
  isAdmin,
  selectedIds,
  closingTargetId,
  isCleaning,
  onToggleTarget,
  onCloseBlockingApps,
}: CacheGroupSectionProps) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

  if (targets.length === 0) {
    return null;
  }

  const meta = GROUP_META[group];
  const GroupIcon = meta.icon;

  const groupTotalBytes = targets.reduce((sum, t) => sum + t.sizeBytes, 0);
  const groupSelectedBytes = targets.reduce(
    (sum, t) => sum + (selectedIds[t.id] ? t.sizeBytes : 0),
    0,
  );

  const toggleDetails = (id: string) => {
    setExpandedPaths((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Encabezado de grupo */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <GroupIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{meta.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{meta.subtitle}</p>
          </div>
        </div>

        <div className="text-right">
          <p className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatBytes(groupTotalBytes)}
          </p>
          {groupSelectedBytes > 0 && (
            <p className="font-mono text-[11px] tabular-nums text-blue-600 dark:text-blue-400">
              {formatBytes(groupSelectedBytes)} seleccionados
            </p>
          )}
        </div>
      </div>

      {/* Lista de objetivos */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {targets.map((target) => {
          const isChecked = Boolean(selectedIds[target.id]);
          const lockedByAdmin = target.requiresAdmin && !isAdmin;
          const isDisabled = lockedByAdmin || isCleaning || target.safety === 'protected';
          const isExpanded = Boolean(expandedPaths[target.id]);
          const isClosingThis = closingTargetId === target.id;

          return (
            <div
              key={target.id}
              className={`px-5 py-4 transition-colors ${
                lockedByAdmin
                  ? 'bg-slate-50/50 dark:bg-slate-950/20'
                  : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={() => onToggleTarget(target.id)}
                  aria-label={`Seleccionar ${target.name}`}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800"
                />

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => onToggleTarget(target.id)}
                        className="text-left text-sm font-semibold text-slate-900 disabled:cursor-default dark:text-slate-100"
                      >
                        {target.name}
                      </button>

                      {/* Semáforo de seguridad en texto limpio (sin píldoras) */}
                      {target.safety === 'safe' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Seguro
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Revisar
                        </span>
                      )}

                      {lockedByAdmin && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                          <Lock className="h-3 w-3" />
                          Requiere Modo Administrador
                        </span>
                      )}

                      {target.inactiveDays !== null && target.inactiveDays >= 14 && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Clock className="h-3 w-3" />
                          Sin actividad hace {target.inactiveDays} días
                        </span>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatBytes(target.sizeBytes)}
                      </span>
                      <span className="ml-2 font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                        {formatNumber(target.fileCount)}{' '}
                        {target.fileCount === 1 ? 'elemento' : 'elementos'}
                      </span>
                    </div>
                  </div>

                  {/* Explicación humana de 1 línea */}
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {target.description}
                  </p>

                  {/* Aviso de aplicación / navegador abierto */}
                  {target.isLockedByRunningApp && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        Abierta actualmente ({target.runningProcessNames.join(', ')}). Ciérrala para
                        liberar el 100% de la caché.
                      </span>
                      <button
                        type="button"
                        disabled={isClosingThis || isCleaning}
                        onClick={() =>
                          onCloseBlockingApps(target.id, target.runningProcessNames)
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                      >
                        {isClosingThis && <Loader2 className="h-3 w-3 animate-spin" />}
                        Cerrar aplicación
                      </button>
                    </div>
                  )}

                  {/* Detalle expandible de rutas técnicas */}
                  {target.paths.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleDetails(target.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        {isExpanded
                          ? 'Ocultar rutas técnicas'
                          : `Ver rutas técnicas (${target.paths.length})`}
                      </button>

                      {isExpanded && (
                        <ul className="mt-1.5 space-y-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                          {target.paths.map((p) => (
                            <li key={p} className="truncate" title={p}>
                              {p}
                              {target.filePrefixFilter ? `\\${target.filePrefixFilter}*.db` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
