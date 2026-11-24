import {
  CheckCircle2,
  Copy,
  Database,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Shield,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ROUTE_CATALOG } from '../../utils/formatters';

export function EnvironmentDiagnostics() {
  const isTauri = useAppStore((state) => state.isTauri);
  const appStatus = useAppStore((state) => state.appStatus);
  const isLoadingStatus = useAppStore((state) => state.isLoadingStatus);
  const statusError = useAppStore((state) => state.statusError);
  const refreshDiagnostics = useAppStore((state) => state.refreshDiagnostics);
  const addToast = useAppStore((state) => state.addToast);

  const handleCopyPath = async (label: string, pathValue: string) => {
    try {
      await navigator.clipboard.writeText(pathValue);
      addToast({
        title: 'Ruta copiada',
        message: `Se copió ${label} al portapapeles.`,
        variant: 'success',
        durationMs: 3000,
      });
    } catch {
      addToast({
        title: 'No se pudo copiar la ruta',
        message: 'El portapapeles no está disponible en este entorno.',
        variant: 'warning',
      });
    }
  };

  if (isLoadingStatus) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="h-5 w-52 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2 py-2">
              <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-64 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!isTauri) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
              <TerminalSquare className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Diagnóstico del entorno nativo (Windows / Tauri v2)
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Estás viendo la interfaz web en el navegador. Al abrir DiskVault Clean en Windows con{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  npm run tauri dev
                </code>
                , esta tarjeta mostrará en vivo tu modo de ejecución (Portable o Instalado), la ruta real
                de SQLite y el estado de permisos UAC.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Motor Backend</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Rust + Tauri v2
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Almacenamiento</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              SQLite embebido (bundled)
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Protección del SO</p>
            <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Lista negra activa en Rust
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Detección Portable</p>
            <p className="mt-1 font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
              portable.flag → ./data/
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (statusError || !appStatus) {
    return (
      <section className="rounded-xl border border-red-200 bg-white p-6 dark:border-red-900/60 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                No se pudo leer el estado del entorno
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {statusError ?? 'Respuesta vacía del backend de Tauri.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshDiagnostics()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Reintentar</span>
          </button>
        </div>
      </section>
    );
  }

  const initialRouteLabel = ROUTE_CATALOG[appStatus.initialRoute]?.label ?? appStatus.initialRoute;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Diagnóstico del entorno
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Verificación en tiempo real de almacenamiento local, base de datos SQLite y permisos de Windows.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshDiagnostics()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Cuadrícula de estado principal (sin tarjetas anidadas, separación por aire y bordes finos) */}
      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <HardDrive className="h-3.5 w-3.5" />
            <span>Modo de ejecución</span>
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {appStatus.isPortable ? 'Modo Portable' : 'Modo Instalado'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {appStatus.isPortable
              ? 'Detectado portable.flag junto al .exe'
              : 'Usando perfil estándar %APPDATA%'}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            {appStatus.isAdmin ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            )}
            <span>Permisos Windows (UAC)</span>
          </div>
          <p
            className={`text-sm font-semibold ${
              appStatus.isAdmin
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {appStatus.isAdmin ? 'Modo Administrador Activo' : 'Usuario Estándar'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {appStatus.isAdmin
              ? 'Acceso completo para limpieza y sistema'
              : 'Elevación bajo demanda disponible'}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Database className="h-3.5 w-3.5" />
            <span>Base de datos SQLite</span>
          </div>
          <div className="flex items-center gap-1.5">
            {appStatus.dbConnected ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            )}
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {appStatus.dbConnected ? 'Conectada y lista' : 'Sin conexión'}
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tablas: settings, audit_logs, nas_targets
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Instancia y vista inicial</span>
          </div>
          <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            v{appStatus.appVersion}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Abierta en: {initialRouteLabel}
          </p>
        </div>
      </div>

      {/* Detalle de rutas locales en tipografía monoespaciada con botón de copia */}
      <div className="mt-6 space-y-2.5 border-t border-slate-100 pt-5 dark:border-slate-800">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Carpeta de datos:{' '}
            </span>
            <span className="break-all font-mono text-xs text-slate-800 dark:text-slate-200">
              {appStatus.dataDir}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyPath('la carpeta de datos', appStatus.dataDir)}
            className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 sm:self-auto dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copiar</span>
          </button>
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Archivo SQLite:{' '}
            </span>
            <span className="break-all font-mono text-xs text-slate-800 dark:text-slate-200">
              {appStatus.dbPath}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyPath('la ruta de diskvault.db', appStatus.dbPath)}
            className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 sm:self-auto dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copiar</span>
          </button>
        </div>
      </div>
    </section>
  );
}
