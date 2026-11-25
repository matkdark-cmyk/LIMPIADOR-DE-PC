import type { ComponentType } from 'react';
import {
  AppWindow,
  Eraser,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Server,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { AppRoute } from '../../types';
import { PRIMARY_NAV_ROUTES, ROUTE_CATALOG } from '../../utils/formatters';

interface IconProps {
  className?: string;
}

const ROUTE_ICONS: Record<AppRoute, ComponentType<IconProps>> = {
  dashboard: LayoutDashboard,
  analyzer: HardDrive,
  apps: AppWindow,
  nas: Server,
  cleaner: Eraser,
  ram: MemoryStick,
  settings: Settings,
};

export function Sidebar() {
  const activeRoute = useAppStore((state) => state.activeRoute);
  const setActiveRoute = useAppStore((state) => state.setActiveRoute);
  const appStatus = useAppStore((state) => state.appStatus);

  const renderNavItem = (routeId: AppRoute) => {
    const meta = ROUTE_CATALOG[routeId];
    const Icon = ROUTE_ICONS[routeId];
    const isActive = activeRoute === routeId;

    return (
      <button
        key={routeId}
        type="button"
        onClick={() => setActiveRoute(routeId)}
        aria-current={isActive ? 'page' : undefined}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
        }`}
      >
        <Icon
          className={`h-[18px] w-[18px] shrink-0 transition-colors ${
            isActive
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
          }`}
        />
        <span className="truncate whitespace-nowrap">{meta.label}</span>
      </button>
    );
  };

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Marca principal */}
      <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200 px-5 dark:border-slate-800">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs dark:bg-blue-500"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="2.2" />
            <path d="M12 4v2" />
            <path d="M18.3 15.6L16.5 14.5" />
          </svg>
        </div>
        <div className="min-w-0">
          <span className="block truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            DiskVault Clean
          </span>
        </div>
      </div>

      {/* Navegación principal (6 módulos) */}
      <nav aria-label="Navegación principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {PRIMARY_NAV_ROUTES.map(renderNavItem)}
      </nav>

      {/* Sección inferior fijada: Ajustes y versión */}
      <div className="shrink-0 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
        {renderNavItem('settings')}
        <div className="mt-2 flex items-center justify-between px-3 pt-1 text-xs text-slate-400 dark:text-slate-500">
          <span>Windows x64</span>
          <span className="font-mono tabular-nums">
            v{appStatus?.appVersion ?? '1.2.0'}
          </span>
        </div>
      </div>
    </aside>
  );
}
