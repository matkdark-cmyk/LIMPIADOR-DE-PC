import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Clock,
  FolderOpen,
  FolderOutput,
  HardDrive,
  Laptop,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getEffectiveAppSize, useAppsStore } from '../../store/useAppsStore';
import type { AppFilterKey, AppSortKey, InstalledApp } from '../../types';
import { formatBytes, formatNumber } from '../../utils/format';
import {
  formatInstallDateEs,
  formatRelativeTimeEs,
  getDaysSinceIso,
} from '../../utils/formatters';
import { invokeOpenInExplorer, isTauriRuntime } from '../../utils/tauri';

const FILTER_OPTIONS: { key: AppFilterKey; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'heaviest', label: 'Más pesadas' },
  { key: 'unused30', label: 'Sin usar > 30 días' },
  { key: 'unused90', label: 'Sin usar > 90 días' },
  { key: 'win32', label: 'Escritorio (Win32)' },
  { key: 'uwp', label: 'Microsoft Store' },
  { key: 'relocated', label: 'Ya reubicadas' },
];

const HEAVIEST_THRESHOLD_BYTES = 250 * 1024 * 1024; // 250 MiB
const INITIAL_VISIBLE_LIMIT = 80;

function getAppInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) {
    return 'AP';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function getUnusedReferenceTimestamp(app: InstalledApp): string | null {
  return app.lastUsedTimestamp ?? (app.installDate ? `${app.installDate}T00:00:00Z` : null);
}

export function InstalledAppsList() {
  const isTauri = useAppStore((s) => s.isTauri);
  const addToast = useAppStore((s) => s.addToast);

  const apps = useAppsStore((s) => s.apps);
  const isLoadingApps = useAppsStore((s) => s.isLoadingApps);
  const isEnrichingMetadata = useAppsStore((s) => s.isEnrichingMetadata);
  const enrichedCount = useAppsStore((s) => s.enrichedCount);
  const totalToEnrich = useAppsStore((s) => s.totalToEnrich);
  const includeUwp = useAppsStore((s) => s.includeUwp);
  const searchQuery = useAppsStore((s) => s.searchQuery);
  const activeFilter = useAppsStore((s) => s.activeFilter);
  const sortMode = useAppsStore((s) => s.sortMode);
  const loadError = useAppsStore((s) => s.loadError);

  const loadApps = useAppsStore((s) => s.loadApps);
  const setIncludeUwp = useAppsStore((s) => s.setIncludeUwp);
  const setSearchQuery = useAppsStore((s) => s.setSearchQuery);
  const setActiveFilter = useAppsStore((s) => s.setActiveFilter);
  const setSortMode = useAppsStore((s) => s.setSortMode);
  const openUninstallModal = useAppsStore((s) => s.openUninstallModal);
  const openRelocateModal = useAppsStore((s) => s.openRelocateModal);

  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_LIMIT);
  const [failedIcons, setFailedIcons] = useState<Record<string, true>>({});

  useEffect(() => {
    void loadApps(false);
  }, [loadApps]);

  // Reiniciar límite visible al cambiar búsqueda o filtro
  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_LIMIT);
  }, [searchQuery, activeFilter, sortMode]);

  const stats = useMemo(() => {
    let totalBytes = 0;
    let unused90Count = 0;
    let relocatedCount = 0;
    let maxAppBytes = 1;

    for (const app of apps) {
      const size = getEffectiveAppSize(app);
      totalBytes += size;
      if (size > maxAppBytes) {
        maxAppBytes = size;
      }
      const days = getDaysSinceIso(getUnusedReferenceTimestamp(app));
      if (days !== null && days >= 90) {
        unused90Count += 1;
      }
      if (app.isRelocated) {
        relocatedCount += 1;
      }
    }

    return { totalBytes, unused90Count, relocatedCount, maxAppBytes };
  }, [apps]);

  const filteredAndSortedApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = apps.filter((app) => {
      if (query.length > 0) {
        const matchName = app.name.toLowerCase().includes(query);
        const matchPub = (app.publisher ?? '').toLowerCase().includes(query);
        if (!matchName && !matchPub) {
          return false;
        }
      }

      switch (activeFilter) {
        case 'heaviest':
          return getEffectiveAppSize(app) >= HEAVIEST_THRESHOLD_BYTES;
        case 'unused30': {
          const days = getDaysSinceIso(getUnusedReferenceTimestamp(app));
          return days !== null && days >= 30;
        }
        case 'unused90': {
          const days = getDaysSinceIso(getUnusedReferenceTimestamp(app));
          return days !== null && days >= 90;
        }
        case 'win32':
          return app.appType === 'win32';
        case 'uwp':
          return app.appType === 'uwp';
        case 'relocated':
          return app.isRelocated;
        case 'all':
        default:
          return true;
      }
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'name') {
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      }
      if (sortMode === 'oldest') {
        const daysA = getDaysSinceIso(getUnusedReferenceTimestamp(a)) ?? -1;
        const daysB = getDaysSinceIso(getUnusedReferenceTimestamp(b)) ?? -1;
        if (daysB !== daysA) {
          return daysB - daysA;
        }
        return getEffectiveAppSize(b) - getEffectiveAppSize(a);
      }
      // Default: 'size' (Mayor a Menor)
      const diff = getEffectiveAppSize(b) - getEffectiveAppSize(a);
      if (diff !== 0) {
        return diff;
      }
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });

    return sorted;
  }, [apps, searchQuery, activeFilter, sortMode]);

  const visibleApps = useMemo(
    () => filteredAndSortedApps.slice(0, visibleLimit),
    [filteredAndSortedApps, visibleLimit],
  );

  const handleOpenFolder = async (app: InstalledApp) => {
    const targetPath = app.relocatedTarget ?? app.installLocation;
    if (!targetPath) {
      return;
    }
    if (!isTauriRuntime()) {
      addToast({
        title: 'Disponible en la aplicación de Windows',
        message: 'Ejecuta DiskVault Clean en Windows para abrir la carpeta en el Explorador.',
        variant: 'info',
      });
      return;
    }
    try {
      await invokeOpenInExplorer(targetPath);
    } catch (err) {
      addToast({
        title: 'No se pudo abrir la carpeta',
        message: typeof err === 'string' ? err : 'La carpeta ya no existe o no es accesible.',
        variant: 'error',
      });
    }
  };

  const enrichPercent =
    totalToEnrich > 0 ? Math.min(100, Math.round((enrichedCount / totalToEnrich) * 100)) : 0;

  if (!isTauri) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Package className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Gestor, Desinstalador y Reubicador de Aplicaciones
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Esta pantalla lee el Registro real de Windows, calcula el tamaño exacto en disco de
                cada programa instalado, limpia archivos residuales tras desinstalar y reubica
                aplicaciones pesadas a otro disco local mediante enlaces automáticos NTFS.
              </p>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Inicia la aplicación de escritorio en Windows con{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  npm run tauri dev
                </code>{' '}
                para administrar tus programas reales.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Barra superior de resumen */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Aplicaciones detectadas
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatNumber(apps.length)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Espacio total ocupado
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                {formatBytes(stats.totalBytes)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Sin usar &gt; 90 días
              </p>
              <button
                type="button"
                onClick={() =>
                  setActiveFilter(activeFilter === 'unused90' ? 'all' : 'unused90')
                }
                className="mt-1 text-left font-mono text-2xl font-bold tabular-nums text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                title="Filtrar aplicaciones sin uso reciente"
              >
                {formatNumber(stats.unused90Count)}
              </button>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Movidas a otro disco
              </p>
              <button
                type="button"
                onClick={() =>
                  setActiveFilter(activeFilter === 'relocated' ? 'all' : 'relocated')
                }
                className="mt-1 text-left font-mono text-2xl font-bold tabular-nums text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                title="Filtrar aplicaciones ya reubicadas"
              >
                {formatNumber(stats.relocatedCount)}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 select-none dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeUwp}
                disabled={isLoadingApps}
                onChange={(e) => {
                  void setIncludeUwp(e.target.checked);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
              />
              Incluir Microsoft Store
            </label>

            <button
              type="button"
              disabled={isLoadingApps}
              onClick={() => {
                void loadApps(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingApps ? 'animate-spin' : ''}`} />
              Actualizar lista
            </button>
          </div>
        </div>

        {/* Progreso discreto en segundo plano mientras se calcula el peso real en disco */}
        {isEnrichingMetadata && (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-2 font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                Calculando peso exacto en disco e íconos oficiales...
              </span>
              <span className="font-mono tabular-nums">
                {formatNumber(enrichedCount)} / {formatNumber(totalToEnrich)} ({enrichPercent}%)
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-500"
                style={{ width: `${Math.max(4, enrichPercent)}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Buscador, filtros interactivos y ordenamiento */}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar aplicación o fabricante..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="apps-sort-select"
              className="text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              Ordenar por:
            </label>
            <select
              id="apps-sort-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as AppSortKey)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="size">Peso (Mayor a Menor)</option>
              <option value="name">Nombre (A–Z)</option>
              <option value="oldest">Más tiempo sin usar</option>
            </select>
          </div>
        </div>

        {/* Botones de filtro */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_OPTIONS.map((opt) => {
            const active = activeFilter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setActiveFilter(opt.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Error de carga */}
      {loadError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">No se pudo leer el inventario de programas</p>
            <p className="mt-0.5 text-xs opacity-90">{loadError}</p>
          </div>
        </div>
      )}

      {/* Tabla principal de aplicaciones */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {isLoadingApps && apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Leyendo aplicaciones instaladas en Windows...
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Consultando el Registro y paquetes de Microsoft Store
              </p>
            </div>
          </div>
        ) : filteredAndSortedApps.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <Package className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              No se encontraron aplicaciones con ese criterio
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Prueba cambiando el filtro activo o borrando el texto de búsqueda.
            </p>
            {(searchQuery.length > 0 || activeFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveFilter('all');
                }}
                className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Ver todas las aplicaciones
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                    <th className="py-3 pr-4 pl-5">Aplicación</th>
                    <th className="w-52 px-4 py-3">Tamaño en disco</th>
                    <th className="w-44 px-4 py-3">Último uso / Instalada</th>
                    <th className="w-72 py-3 pr-5 pl-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {visibleApps.map((app) => {
                    const effectiveBytes = getEffectiveAppSize(app);
                    const widthPct = Math.max(
                      2,
                      Math.min(100, Math.round((effectiveBytes / stats.maxAppBytes) * 100)),
                    );
                    const lastUsedIso = getUnusedReferenceTimestamp(app);
                    const daysUnused = getDaysSinceIso(lastUsedIso);
                    const isStale = daysUnused !== null && daysUnused >= 90;
                    const showIconImg = Boolean(app.iconDataUrl && !failedIcons[app.id]);

                    return (
                      <tr
                        key={app.id}
                        className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      >
                        {/* Aplicación */}
                        <td className="py-3.5 pr-4 pl-5">
                          <div className="flex items-start gap-3">
                            {showIconImg ? (
                              <img
                                src={app.iconDataUrl ?? ''}
                                alt=""
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setFailedIcons((prev) => ({ ...prev, [app.id]: true }))
                                }
                                className="mt-0.5 h-8 w-8 shrink-0 rounded-md object-contain"
                              />
                            ) : (
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {getAppInitials(app.name)}
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {app.name}
                                </span>
                                {app.version && (
                                  <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                                    v{app.version}
                                  </span>
                                )}
                              </div>

                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                <span className="truncate">
                                  {app.publisher ?? 'Fabricante no indicado'}
                                </span>

                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {app.appType === 'uwp' ? (
                                    <>
                                      <ShoppingBag className="h-3 w-3 text-blue-500" />
                                      Store
                                    </>
                                  ) : (
                                    <>
                                      <Laptop className="h-3 w-3 text-slate-400" />
                                      Escritorio
                                    </>
                                  )}
                                </span>

                                {app.isRelocated && (
                                  <span
                                    title={
                                      app.relocatedTarget
                                        ? `Carpeta real ubicada en: ${app.relocatedTarget}`
                                        : 'Aplicación movida mediante enlace NTFS'
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                                  >
                                    <ArrowRightLeft className="h-3 w-3" />
                                    Movida a {app.relocatedTarget ?? 'otro disco'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Tamaño en disco */}
                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {effectiveBytes > 0 ? formatBytes(effectiveBytes) : '—'}
                            </span>
                            {app.realSizeBytes === null && effectiveBytes > 0 && (
                              <span
                                className="text-[11px] text-slate-400 dark:text-slate-500"
                                title="Tamaño reportado por Windows; calculando peso real en disco"
                              >
                                Estimado
                              </span>
                            )}
                          </div>
                          {effectiveBytes > 0 && (
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className="h-full rounded-full bg-blue-600/80 dark:bg-blue-500/80"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          )}
                        </td>

                        {/* Último uso / Instalada */}
                        <td className="px-4 py-3.5 align-middle">
                          <div
                            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                              isStale
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                            title={
                              app.lastUsedTimestamp
                                ? 'Estimado por actividad reciente de archivos ejecutables y datos'
                                : 'Estimado según fecha de instalación'
                            }
                          >
                            <Clock className="h-3.5 w-3.5 shrink-0 opacity-75" />
                            <span>{formatRelativeTimeEs(lastUsedIso)}</span>
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                            Inst.: {formatInstallDateEs(app.installDate)}
                          </p>
                        </td>

                        {/* Acciones */}
                        <td className="py-3.5 pr-5 pl-4 text-right align-middle">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={!app.canRelocate}
                              onClick={() => openRelocateModal(app)}
                              title={
                                app.canRelocate
                                  ? 'Mover esta aplicación a otro disco local manteniendo su funcionamiento'
                                  : app.relocateDisabledReason ??
                                    'Esta aplicación no se puede reubicar automáticamente'
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                            >
                              <FolderOutput className="h-3.5 w-3.5" />
                              Mover
                            </button>

                            <button
                              type="button"
                              onClick={() => openUninstallModal(app)}
                              title="Ejecutar desinstalador oficial y buscar archivos residuales"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Desinstalar
                            </button>

                            {app.installLocation && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleOpenFolder(app);
                                }}
                                title={`Abrir carpeta en el Explorador (${app.relocatedTarget ?? app.installLocation})`}
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pie de tabla / cargar más */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5" />
                Mostrando{' '}
                <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                  {formatNumber(visibleApps.length)}
                </strong>{' '}
                de{' '}
                <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                  {formatNumber(filteredAndSortedApps.length)}
                </strong>{' '}
                aplicaciones
              </span>

              {visibleApps.length < filteredAndSortedApps.length && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 100)}
                  className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Mostrar más ({formatNumber(filteredAndSortedApps.length - visibleApps.length)}{' '}
                  restantes)
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
