import { HardDriveDownload, Loader2, Moon, Shield, ShieldCheck, Sun } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ROUTE_CATALOG } from '../../utils/formatters';

export function Header() {
  const activeRoute = useAppStore((state) => state.activeRoute);
  const appStatus = useAppStore((state) => state.appStatus);
  const isElevating = useAppStore((state) => state.isElevating);
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const requestAdminElevation = useAppStore((state) => state.requestAdminElevation);

  const meta = ROUTE_CATALOG[activeRoute];
  const isAdmin = appStatus?.isAdmin ?? false;
  const isPortable = appStatus?.isPortable ?? false;

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-8 dark:border-slate-800 dark:bg-slate-900">
      {/* Título y subtítulo en lenguaje claro */}
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {meta.title}
        </h1>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {meta.subtitle}
        </p>
      </div>

      {/* Controles de sesión: Portable, UAC y Tema */}
      <div className="flex shrink-0 items-center gap-3">
        {isPortable && (
          <div
            title="Modo Portable activo: datos y configuración guardados junto al ejecutable en ./data/"
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <HardDriveDownload className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <span>Portable</span>
          </div>
        )}

        {isAdmin ? (
          <div
            title="DiskVault Clean está ejecutándose con privilegios de Administrador de Windows"
            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>Modo Administrador Activo</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={isElevating}
            onClick={() => void requestAdminElevation()}
            title="Solicitar permisos de Administrador de Windows (UAC) manteniendo la vista actual"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
          >
            {isElevating ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <Shield className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            )}
            <span>
              {isElevating ? 'Solicitando permisos...' : 'Activar Modo Administrador'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => void toggleTheme()}
          aria-label={resolvedTheme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          title={resolvedTheme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
