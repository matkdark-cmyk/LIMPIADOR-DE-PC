import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  FolderOpen,
  Link2,
  Loader2,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useNasStore } from '../../store/useNasStore';
import type { TransferMode } from '../../types';
import { formatBytes, formatNumber } from '../../utils/format';
import { invokeOpenInExplorer, isTauriRuntime } from '../../utils/tauri';

interface ModeOption {
  id: TransferMode;
  title: string;
  subtitle: string;
  detail: string;
  icon: typeof Archive;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'archive_free',
    title: 'Archivar y liberar espacio',
    subtitle: 'Recomendado para liberar gigas en tu PC',
    detail:
      'Copia al destino, verifica cada archivo con xxHash3 y luego limpia la copia local solo si la integridad es 100%.',
    icon: Archive,
  },
  {
    id: 'move_symlink',
    title: 'Mover con enlace transparente',
    subtitle: 'Ideal para carpetas que tus apps esperan en C:\\',
    detail:
      'Tras verificar con xxHash3, reemplaza la carpeta local por un enlace NTFS/Simbólico apuntando al destino.',
    icon: Link2,
  },
  {
    id: 'copy_backup',
    title: 'Solo respaldar (copia segura)',
    subtitle: 'Conserva los archivos en ambos lugares',
    detail:
      'Copia y verifica con xxHash3 sin eliminar ni modificar nada en tu PC.',
    icon: Copy,
  },
];

export function TransferWizard() {
  const appStatus = useAppStore((state) => state.appStatus);
  const requestAdminElevation = useAppStore((state) => state.requestAdminElevation);
  const isElevating = useAppStore((state) => state.isElevating);

  const targets = useNasStore((state) => state.targets);
  const sourcePath = useNasStore((state) => state.sourcePath);
  const destRoot = useNasStore((state) => state.destRoot);
  const mode = useNasStore((state) => state.mode);
  const sendLocalToTrash = useNasStore((state) => state.sendLocalToTrash);
  const preflight = useNasStore((state) => state.preflight);
  const isCheckingPreflight = useNasStore((state) => state.isCheckingPreflight);
  const preflightError = useNasStore((state) => state.preflightError);
  const isTransferring = useNasStore((state) => state.isTransferring);
  const isScanningThreats = useNasStore((state) => state.isScanningThreats);
  const stoppedThreatReport = useNasStore((state) => state.stoppedThreatReport);

  const setSourcePath = useNasStore((state) => state.setSourcePath);
  const setDestRoot = useNasStore((state) => state.setDestRoot);
  const setMode = useNasStore((state) => state.setMode);
  const setSendLocalToTrash = useNasStore((state) => state.setSendLocalToTrash);
  const pickSourceFolder = useNasStore((state) => state.pickSourceFolder);
  const pickDestFolder = useNasStore((state) => state.pickDestFolder);
  const runPreflight = useNasStore((state) => state.runPreflight);
  const requestStartTransfer = useNasStore((state) => state.requestStartTransfer);
  const clearStoppedThreatReport = useNasStore((state) => state.clearStoppedThreatReport);
  const setActiveSubTab = useNasStore((state) => state.setActiveSubTab);
  const addToast = useAppStore((state) => state.addToast);

  const isAdmin = appStatus?.isAdmin ?? false;
  const destLooksUnc = destRoot.trim().startsWith('\\\\') || destRoot.trim().startsWith('//');
  const needsAdminForUncSymlink = mode === 'move_symlink' && destLooksUnc && !isAdmin;
  const isBusy = isTransferring || isScanningThreats;

  const canStart =
    !isBusy &&
    sourcePath.trim().length > 0 &&
    destRoot.trim().length > 0 &&
    (!preflight || (preflight.fitsInDestination && !preflight.destAlreadyExists));

  const handleOpenThreatLocation = async (filePath: string) => {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invokeOpenInExplorer(filePath);
    } catch (err) {
      addToast({
        title: 'No se pudo abrir la ubicación',
        message: typeof err === 'string' ? err : 'No se pudo abrir el Explorador de Windows.',
        variant: 'error',
      });
    }
  };

  return (
    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 pb-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Asistente de migración segura en 3 fases
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Mueve carpetas pesadas a tu NAS o a otro disco sin riesgo de pérdida de datos gracias a la
          verificación automática xxHash3.
        </p>
      </div>

      {/* Paso 1 y 2: Origen y Destino */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="wizard-source-input"
            className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
          >
            1. Carpeta o archivo local de origen
          </label>
          <div className="flex gap-2">
            <input
              id="wizard-source-input"
              type="text"
              disabled={isTransferring}
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="Ej. C:\Users\Carlos\Videos\Vacaciones"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={isTransferring}
              onClick={() => void pickSourceFolder()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Elegir...</span>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="wizard-dest-input"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              2. Destino (NAS en red o disco secundario)
            </label>
            <button
              type="button"
              onClick={() => setActiveSubTab('targets')}
              className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              Gestionar destinos NAS
            </button>
          </div>

          {targets.length > 0 && (
            <select
              disabled={isTransferring}
              value={
                targets.some((t) => t.path === destRoot) ? destRoot : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  setDestRoot(e.target.value);
                }
              }}
              aria-label="Seleccionar destino guardado"
              className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="__custom__">Elegir destino guardado o escribir ruta...</option>
              {targets.map((target) => (
                <option key={target.id} value={target.path}>
                  {target.name} ({target.path})
                  {target.lastFreeBytes !== null
                    ? ` — ${formatBytes(target.lastFreeBytes)} libres`
                    : ''}
                </option>
              ))}
            </select>
          )}

          <div className="flex gap-2">
            <input
              id="wizard-dest-input"
              type="text"
              disabled={isTransferring}
              value={destRoot}
              onChange={(e) => setDestRoot(e.target.value)}
              placeholder="Ej. \\192.168.1.50\Respaldos o D:\Respaldos"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={isTransferring}
              onClick={() => void pickDestFolder()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Elegir...</span>
            </button>
          </div>
        </div>
      </div>

      {/* Paso 3: Modo de operación */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          3. ¿Qué hacemos tras verificar la integridad con xxHash3?
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = mode === option.id;

            return (
              <button
                key={option.id}
                type="button"
                disabled={isTransferring}
                onClick={() => setMode(option.id)}
                className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60 ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-500/10'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-blue-600 text-white dark:bg-blue-500'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {option.title}
                    </span>
                  </div>
                  <p className="mt-2.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    {option.subtitle}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {option.detail}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Opción de Papelera para modos destructivos */}
        {mode !== 'copy_backup' && (
          <label className="flex items-start gap-2.5 pt-1 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              disabled={isTransferring}
              checked={sendLocalToTrash}
              onChange={(e) => setSendLocalToTrash(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              Al completar la Fase 3, mover la copia local a la Papelera de Reciclaje en vez de
              eliminarla directamente (ten en cuenta que la Papelera seguirá ocupando espacio hasta
              que la vacíes).
            </span>
          </label>
        )}

        {/* Aviso si pide Symlink hacia red UNC sin UAC */}
        {needsAdminForUncSymlink && (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-start gap-2.5">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
              <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-200">
                Windows requiere <strong>Modo Administrador</strong> para crear enlaces simbólicos
                apuntando a una carpeta de red UNC (<span className="font-mono">\\NAS\...</span>).
                Para discos locales (<span className="font-mono">D:\</span>) no es necesario.
              </p>
            </div>
            <button
              type="button"
              disabled={isElevating}
              onClick={() => void requestAdminElevation()}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-200"
            >
              Activar Modo Administrador
            </button>
          </div>
        )}
      </div>

      {/* Diagnóstico previo (Preflight) */}
      {preflightError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/70 px-4 py-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span>{preflightError}</span>
        </div>
      )}

      {preflight && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Archivos a transferir</span>
              <p className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatNumber(preflight.filesCount)} archivos · {formatBytes(preflight.totalBytes)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Espacio libre en destino</span>
              <p
                className={`mt-0.5 font-mono font-semibold tabular-nums ${
                  preflight.fitsInDestination
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {preflight.destFreeBytes > 0
                  ? formatBytes(preflight.destFreeBytes)
                  : 'No reportado'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Ruta final en destino</span>
              <p
                className="mt-0.5 truncate font-mono text-slate-800 dark:text-slate-200"
                title={preflight.resolvedDestPath}
              >
                {preflight.resolvedDestPath}
              </p>
            </div>
          </div>

          {!preflight.fitsInDestination && (
            <p className="mt-3 flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                No hay espacio suficiente en el destino seleccionado para completar esta copia.
              </span>
            </p>
          )}

          {preflight.destAlreadyExists && (
            <p className="mt-3 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Ya existe "{preflight.sourceName}" dentro del destino. Elige otra subcarpeta para
                evitar sobrescribir respaldos anteriores.
              </span>
            </p>
          )}
        </div>
      )}

      {/* Detalle persistente cuando el usuario detuvo el copiado por virus/archivos sospechosos */}
      {stoppedThreatReport && stoppedThreatReport.findings.length > 0 && (
        <div className="space-y-3 rounded-xl border border-red-300 bg-red-50/70 p-4 text-xs dark:border-red-900/70 dark:bg-red-950/35">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-semibold text-red-900 dark:text-red-200">
                  Copiado detenido por seguridad ({stoppedThreatReport.findings.length} hallazgo
                  {stoppedThreatReport.findings.length === 1 ? '' : 's'})
                </p>
                <p className="mt-0.5 text-red-800/90 dark:text-red-300/90">
                  No se copió ningún archivo al disco o NAS. Verifica las rutas encontradas a
                  continuación antes de volver a intentar:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearStoppedThreatReport}
              aria-label="Ocultar aviso de seguridad"
              className="rounded-md p-1 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {stoppedThreatReport.findings.map((item, index) => (
              <li
                key={`${item.filePath}-${index}`}
                className="rounded-lg border border-red-200/80 bg-white/90 p-3 dark:border-red-900/60 dark:bg-slate-900/80"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        item.severity === 'malware'
                          ? 'bg-red-600 text-white'
                          : 'bg-amber-600 text-white'
                      }`}
                    >
                      {item.severity === 'malware' ? 'Virus / Amenaza' : 'Sospechoso'}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {item.threatName}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      ({item.engine})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenThreatLocation(item.filePath)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    Abrir ubicación
                  </button>
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{item.reason}</p>
                <p className="mt-1.5 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] break-all text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {item.filePath}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Garantía de seguridad + Botones de acción */}
      <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              Escaneo antivirus y Paso 2 (xxHash3) bajo tu control:
            </strong>{' '}
            al iniciar te preguntaremos si deseas escanear antes de copiar (incluye Paso 2 xxHash3)
            o copiar directamente saltando el escaneo y el Paso 2. Ante cualquier advertencia,
            siempre podrás decidir si continuar o detener el proceso.
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 self-end sm:self-auto">
          <button
            type="button"
            disabled={isCheckingPreflight || isBusy || !sourcePath.trim() || !destRoot.trim()}
            onClick={() => void runPreflight()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {isCheckingPreflight ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            <span>Comprobar espacio</span>
          </button>

          <button
            type="button"
            disabled={!canStart}
            onClick={requestStartTransfer}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {isScanningThreats ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Analizando seguridad...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Iniciar migración segura</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
