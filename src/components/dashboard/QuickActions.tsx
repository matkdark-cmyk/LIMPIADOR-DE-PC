import { ArrowRight, Eraser, HardDrive, MemoryStick } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useCleanerStore } from '../../store/useCleanerStore';
import type { AppRoute } from '../../types';

interface QuickActionItem {
  route: AppRoute;
  title: string;
  description: string;
  icon: typeof HardDrive;
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    route: 'analyzer',
    title: 'Encontrar Archivos Pesados',
    description:
      'Escanea tus discos de mayor a menor para ubicar carpetas gigantes, videos o instaladores olvidados.',
    icon: HardDrive,
  },
  {
    route: 'cleaner',
    title: 'Limpiar Caché Segura',
    description:
      'Recupera espacio eliminando temporales de Windows, cachés de navegadores y restos con semáforo de riesgo.',
    icon: Eraser,
  },
  {
    route: 'ram',
    title: 'Liberar Memoria RAM',
    description:
      'Revisa qué programas consumen más memoria y optimiza la RAM retenida en segundo plano.',
    icon: MemoryStick,
  },
];

export function QuickActions() {
  const setActiveRoute = useAppStore((state) => state.setActiveRoute);

  const handleActionClick = (route: AppRoute) => {
    setActiveRoute(route);
    if (route === 'cleaner' && !useCleanerStore.getState().hasScannedOnce) {
      void useCleanerStore.getState().scanCaches(false);
    }
  };

  return (
    <section aria-label="Acciones rápidas" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {QUICK_ACTIONS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.route}
            type="button"
            onClick={() => handleActionClick(item.route)}
            className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 text-left transition-colors duration-150 hover:border-blue-300 hover:bg-slate-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500/50 dark:hover:bg-slate-800/60"
          >
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-500/15 dark:text-blue-400 dark:group-hover:bg-blue-500 dark:group-hover:text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {item.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {item.description}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <span>Abrir herramienta</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </div>
          </button>
        );
      })}
    </section>
  );
}
