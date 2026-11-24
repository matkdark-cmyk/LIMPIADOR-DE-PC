import { Shield, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export function UacBanner() {
  const appStatus = useAppStore((state) => state.appStatus);
  const isTauri = useAppStore((state) => state.isTauri);
  const uacBannerDismissed = useAppStore((state) => state.uacBannerDismissed);
  const dismissUacBanner = useAppStore((state) => state.dismissUacBanner);
  const requestAdminElevation = useAppStore((state) => state.requestAdminElevation);
  const isElevating = useAppStore((state) => state.isElevating);

  if (!isTauri || !appStatus || appStatus.isAdmin || uacBannerDismissed) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          <Shield className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Ejecución en modo estándar (UAC bajo demanda)
          </p>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Puedes explorar discos y respaldar carpetas al NAS sin permisos especiales. Solo necesitarás
            activar el Modo Administrador al desinstalar programas, limpiar cachés globales de Windows o
            purgar la memoria en espera (Standby List).
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        <button
          type="button"
          disabled={isElevating}
          onClick={() => void requestAdminElevation()}
          className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          Activar ahora
        </button>
        <button
          type="button"
          onClick={dismissUacBanner}
          aria-label="Ocultar aviso de permisos"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
