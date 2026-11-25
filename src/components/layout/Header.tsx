import {
  ArrowDownCircle,
  HardDriveDownload,
  Loader2,
  Monitor,
  Moon,
  PowerOff,
  Shield,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import type { ThemeMode } from '../../types';
import { ROUTE_CATALOG } from '../../utils/formatters';

const THEME_SWITCH_OPTIONS: {
  id: ThemeMode;
  label: string;
  title: string;
  icon: typeof Sun;
}[] = [
  { id: 'light', label: 'Claro', title: 'Activar tema claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', title: 'Activar modo oscuro', icon: Moon },
  {
    id: 'system',
    label: 'Windows',
    title: 'Usar automáticamente el tema y colores de Windows',
    icon: Monitor,
  },
];

export function Header() {
  const activeRoute = useAppStore((state) => state.activeRoute);
  const appStatus = useAppStore((state) => state.appStatus);
  const isElevating = useAppStore((state) => state.isElevating);
  const theme = useAppStore((state) => state.theme);
  const isSavingSettings = useAppStore((state) => state.isSavingSettings);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const requestAdminElevation = useAppStore((state) => state.requestAdminElevation);
  const disableAdminMode = useAppStore((state) => state.disableAdminMode);
  const updateInfo = useUpdaterStore((state) => state.updateInfo);
  const openUpdateModal = useUpdaterStore((state) => state.openUpdateModal);

  const meta = ROUTE_CATALOG[activeRoute];
  const isAdmin = appStatus?.isAdmin ?? false;
  const isPortable = appStatus?.isPortable ?? false;

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-8 dark:border-slate-800 dark:bg-slate-900">
      {/* Título y subtítulo en lenguaje claro */}
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {meta.title}
        </h1>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {meta.subtitle}
        </p>
      </div>

      {/* Controles de sesión: Actualización, Portable, UAC y Selector Claro / Oscuro / Windows */}
      <div className="flex shrink-0 items-center gap-2.5">
        {updateInfo?.updateAvailable && (
          <button
            type="button"
            onClick={openUpdateModal}
            title="Ver detalles de la nueva actualización disponible antes de instalar"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
          >
            <ArrowDownCircle className="h-4 w-4 shrink-0" />
            <span>Actualizar a v{updateInfo.latestVersion}</span>
          </button>
        )}

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
          <div className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-950/50">
            <div
              title="Modo Administrador activo en cada sesión hasta que decidas desactivarlo"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap dark:text-emerald-300"
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Modo Administrador</span>
            </div>
            <button
              type="button"
              disabled={isElevating}
              onClick={() => void disableAdminMode()}
              title="Desactivar Modo Administrador y reiniciar en modo estándar"
              className="inline-flex items-center gap-1 border-l border-emerald-200/90 px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap dark:border-emerald-800/70 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
            >
              {isElevating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              ) : (
                <PowerOff className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>Desactivar</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={isElevating}
            onClick={() => void requestAdminElevation()}
            title="Activar Modo Administrador (permanecerá activo en cada sesión hasta que lo desactives)"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
          >
            {isElevating ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <Shield className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            )}
            <span>
              {isElevating ? 'Activando...' : 'Activar Modo Administrador'}
            </span>
          </button>
        )}

        {/* Selector rápido de tema: Claro / Oscuro / Windows */}
        <div
          role="group"
          aria-label="Seleccionar tema visual"
          className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800"
        >
          {THEME_SWITCH_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={isSavingSettings}
                aria-pressed={isSelected}
                title={opt.title}
                onClick={() => void setThemeMode(opt.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isSelected
                    ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
