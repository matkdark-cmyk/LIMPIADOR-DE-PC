import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ToastVariant } from '../../types';

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    container: string;
    iconColor: string;
  }
> = {
  success: {
    container:
      'border-emerald-200 bg-white text-slate-900 dark:border-emerald-800/70 dark:bg-slate-900 dark:text-slate-100',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    container:
      'border-amber-200 bg-white text-slate-900 dark:border-amber-800/70 dark:bg-slate-900 dark:text-slate-100',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  error: {
    container:
      'border-red-200 bg-white text-slate-900 dark:border-red-800/70 dark:bg-slate-900 dark:text-slate-100',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  info: {
    container:
      'border-blue-200 bg-white text-slate-900 dark:border-blue-800/70 dark:bg-slate-900 dark:text-slate-100',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  const className = `mt-0.5 h-4 w-4 shrink-0 ${VARIANT_STYLES[variant].iconColor}`;
  switch (variant) {
    case 'success':
      return <CheckCircle2 className={className} />;
    case 'warning':
      return <AlertTriangle className={className} />;
    case 'error':
      return <XCircle className={className} />;
    case 'info':
      return <Info className={className} />;
  }
}

export function ToastContainer() {
  const toasts = useAppStore((state) => state.toasts);
  const removeToast = useAppStore((state) => state.removeToast);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-label="Notificaciones del sistema"
      className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-full max-w-sm flex-col gap-2.5"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3.5 shadow-lg transition-all duration-150 ${VARIANT_STYLES[toast.variant].container}`}
        >
          <ToastIcon variant={toast.variant} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-semibold leading-snug">{toast.title}</p>
            {toast.message && (
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {toast.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Cerrar notificación"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
