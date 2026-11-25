import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FolderOpen,
  FolderPlus,
  HardDriveDownload,
  History,
  Info,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useAppStore } from '../../store/useAppStore';
import { useCleanerStore } from '../../store/useCleanerStore';
import { useNasStore } from '../../store/useNasStore';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import type { InactiveDaysOption, ThemeMode, TransferMode } from '../../types';
import { formatBytes, formatDateTime } from '../../utils/format';
import { formatActionName, formatModuleName } from '../../utils/formatters';
import {
  invokeClearOldAuditLogs,
  invokeExportAuditLogs,
  invokeOpenDataFolder,
  pickFolderDialog,
  saveExportFileDialog,
} from '../../utils/tauri';

const THEME_OPTIONS: { id: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Claro', description: 'Fondo luminoso de alto contraste', icon: Sun },
  { id: 'dark', label: 'Oscuro', description: 'Descansa la vista en poca luz', icon: Moon },
  {
    id: 'system',
    label: 'Seguir a Windows',
    description: 'Se adapta automáticamente al sistema',
    icon: Monitor,
  },
];

const NAS_MODE_OPTIONS: { id: TransferMode; label: string }[] = [
  { id: 'archive_free', label: 'Archivar y liberar espacio (recomendado)' },
  { id: 'move_symlink', label: 'Mover con enlace transparente (Junction/Symlink)' },
  { id: 'copy_backup', label: 'Solo respaldar (copia segura sin borrar origen)' },
];

const INACTIVE_DAY_OPTIONS: InactiveDaysOption[] = [15, 30, 60, 90];

const AUDIT_MODULE_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'analyzer', label: 'Analizador' },
  { id: 'nas', label: 'Mover al NAS' },
  { id: 'apps', label: 'Aplicaciones' },
  { id: 'cleaner', label: 'Limpieza' },
  { id: 'ram', label: 'Memoria RAM' },
  { id: 'settings', label: 'Ajustes' },
];

const LOGS_PER_PAGE = 8;

function extractError(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'No se pudo completar la operación solicitada.';
}

export function SettingsView() {
  const isTauri = useAppStore((s) => s.isTauri);
  const appStatus = useAppStore((s) => s.appStatus);
  const windowsTheme = useAppStore((s) => s.windowsTheme);
  const settings = useAppStore((s) => s.settings);
  const isSavingSettings = useAppStore((s) => s.isSavingSettings);
  const auditLogs = useAppStore((s) => s.auditLogs);
  const isLoadingLogs = useAppStore((s) => s.isLoadingLogs);

  const loadSettings = useAppStore((s) => s.loadSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetSettings = useAppStore((s) => s.resetSettings);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const isElevating = useAppStore((s) => s.isElevating);
  const requestAdminElevation = useAppStore((s) => s.requestAdminElevation);
  const disableAdminMode = useAppStore((s) => s.disableAdminMode);
  const refreshAuditLogs = useAppStore((s) => s.refreshAuditLogs);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const addToast = useAppStore((s) => s.addToast);

  const updateInfo = useUpdaterStore((s) => s.updateInfo);
  const isCheckingUpdates = useUpdaterStore((s) => s.isChecking);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const openUpdateModal = useUpdaterStore((s) => s.openUpdateModal);

  const [newRamProcess, setNewRamProcess] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const [isExporting, setIsExporting] = useState(false);
  const [isCleaningLogs, setIsCleaningLogs] = useState(false);
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [cleanLogsModalOpen, setCleanLogsModalOpen] = useState(false);

  const isPortable = appStatus?.isPortable ?? false;
  const isAdmin = appStatus?.isAdmin ?? false;

  useEscapeKey(resetModalOpen, () => setResetModalOpen(false), isSavingSettings);
  useEscapeKey(cleanLogsModalOpen, () => setCleanLogsModalOpen(false), isCleaningLogs);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    void loadSettings();
    void refreshAuditLogs(200);
  }, [isTauri, loadSettings, refreshAuditLogs]);

  // Reiniciar paginación al cambiar el filtro de módulo
  useEffect(() => {
    setPage(1);
  }, [moduleFilter]);

  const filteredLogs = useMemo(() => {
    if (moduleFilter === 'all') {
      return auditLogs;
    }
    return auditLogs.filter((entry) => entry.module === moduleFilter);
  }, [auditLogs, moduleFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedLogs = useMemo(() => {
    const start = (safePage - 1) * LOGS_PER_PAGE;
    return filteredLogs.slice(start, start + LOGS_PER_PAGE);
  }, [filteredLogs, safePage]);

  const handleToggleUseRecycleBin = async () => {
    const nextVal = !settings.defaultUseRecycleBin;
    const saved = await updateSettings(
      { defaultUseRecycleBin: nextVal },
      { toastTitle: nextVal ? 'Papelera activada por defecto' : 'Eliminación directa por defecto' },
    );
    if (saved) {
      useCleanerStore.setState({ useRecycleBin: saved.defaultUseRecycleBin });
      useNasStore.setState({ sendLocalToTrash: saved.defaultUseRecycleBin });
    }
  };

  const handleChangeNasDefaultMode = async (mode: TransferMode) => {
    const saved = await updateSettings(
      { nasDefaultMode: mode },
      { toastTitle: 'Modo predeterminado del NAS actualizado' },
    );
    if (saved) {
      useNasStore.setState({ mode: saved.nasDefaultMode });
    }
  };

  const handleChangeDefaultInactiveDays = async (days: InactiveDaysOption) => {
    const saved = await updateSettings(
      { defaultInactiveDays: days },
      { toastTitle: `Umbral de inactividad guardado (${days} días)` },
    );
    if (saved) {
      useCleanerStore.setState({ inactiveDaysThreshold: days });
    }
  };

  const handleAddRamProcess = async () => {
    const cleaned = newRamProcess.trim().toLowerCase();
    if (!cleaned) {
      return;
    }
    const formatted = cleaned.endsWith('.exe') ? cleaned : `${cleaned}.exe`;
    if (settings.ramExcludedProcesses.includes(formatted)) {
      addToast({
        title: 'Proceso ya incluido',
        message: `${formatted} ya se encuentra en tu lista de procesos protegidos.`,
        variant: 'info',
      });
      setNewRamProcess('');
      return;
    }
    const updated = [...settings.ramExcludedProcesses, formatted];
    setNewRamProcess('');
    await updateSettings(
      { ramExcludedProcesses: updated },
      { toastTitle: `Proceso ${formatted} protegido de la liberación de RAM` },
    );
  };

  const handleRemoveRamProcess = async (procName: string) => {
    const updated = settings.ramExcludedProcesses.filter((item) => item !== procName);
    await updateSettings(
      { ramExcludedProcesses: updated },
      { toastTitle: `Se quitó ${procName} de la lista de exclusiones` },
    );
  };

  const handleAddCleanerExcludedPath = async () => {
    if (!isTauri) {
      addToast({
        title: 'Selector disponible en escritorio',
        message: 'Ejecuta DiskVault Clean en Windows para elegir una carpeta real.',
        variant: 'info',
      });
      return;
    }
    try {
      const selected = await pickFolderDialog('Elegir carpeta a excluir de la limpieza de caché');
      if (!selected) {
        return;
      }
      const alreadyExists = settings.cleanerExcludedPaths.some(
        (p) => p.toLowerCase() === selected.toLowerCase(),
      );
      if (alreadyExists) {
        addToast({
          title: 'Carpeta ya excluida',
          message: 'Esta ruta ya estaba protegida en tu lista de exclusiones.',
          variant: 'info',
        });
        return;
      }
      await updateSettings(
        { cleanerExcludedPaths: [...settings.cleanerExcludedPaths, selected] },
        { toastTitle: 'Carpeta añadida a exclusiones de caché' },
      );
    } catch (err) {
      addToast({
        title: 'No se pudo seleccionar la carpeta',
        message: extractError(err),
        variant: 'error',
      });
    }
  };

  const handleRemoveCleanerExcludedPath = async (folderPath: string) => {
    const updated = settings.cleanerExcludedPaths.filter((p) => p !== folderPath);
    await updateSettings(
      { cleanerExcludedPaths: updated },
      { toastTitle: 'Carpeta eliminada de exclusiones' },
    );
  };

  const handleGoToNasTargets = () => {
    useNasStore.getState().setActiveSubTab('targets');
    setActiveRoute('nas');
  };

  const handleOpenDataFolder = async () => {
    if (!isTauri) {
      addToast({
        title: 'Disponible en aplicación de escritorio',
        message: 'Ejecuta DiskVault Clean en Windows para abrir la carpeta de datos local.',
        variant: 'info',
      });
      return;
    }
    setIsOpeningFolder(true);
    try {
      await invokeOpenDataFolder();
    } catch (err) {
      addToast({
        title: 'No se pudo abrir la carpeta de datos',
        message: extractError(err),
        variant: 'error',
      });
    } finally {
      setIsOpeningFolder(false);
    }
  };

  const handleExportAudit = async (format: 'csv' | 'json') => {
    if (!isTauri) {
      addToast({
        title: 'Exportación disponible en Windows',
        message: 'Ejecuta DiskVault Clean en Windows para exportar tu historial de SQLite.',
        variant: 'info',
      });
      return;
    }

    setIsExporting(true);
    try {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const defaultFile = `DiskVaultClean_Historial_${dateStamp}.${format}`;
      const destPath = await saveExportFileDialog(defaultFile, format);
      if (!destPath) {
        setIsExporting(false);
        return;
      }
      const count = await invokeExportAuditLogs(format, destPath);
      addToast({
        title: `Historial exportado (${format.toUpperCase()})`,
        message: `Se guardaron ${count} registros correctamente.`,
        variant: 'success',
      });
      await refreshAuditLogs(200);
    } catch (err) {
      addToast({
        title: 'No se pudo exportar el historial',
        message: extractError(err),
        variant: 'error',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirmCleanOldLogs = async () => {
    if (!isTauri) {
      setCleanLogsModalOpen(false);
      return;
    }
    setIsCleaningLogs(true);
    try {
      const deleted = await invokeClearOldAuditLogs(30);
      setCleanLogsModalOpen(false);
      addToast({
        title: 'Historial antiguo limpiado',
        message:
          deleted > 0
            ? `Se eliminaron ${deleted} registros con más de 30 días de antigüedad.`
            : 'No había registros anteriores a los últimos 30 días.',
        variant: 'success',
      });
      await refreshAuditLogs(200);
    } catch (err) {
      addToast({
        title: 'No se pudo limpiar el historial antiguo',
        message: extractError(err),
        variant: 'error',
      });
    } finally {
      setIsCleaningLogs(false);
    }
  };

  const handleConfirmResetSettings = async () => {
    const reset = await resetSettings();
    setResetModalOpen(false);
    if (reset) {
      useCleanerStore.setState({
        useRecycleBin: reset.defaultUseRecycleBin,
        inactiveDaysThreshold: 30,
      });
      useNasStore.setState({
        mode: reset.nasDefaultMode,
        sendLocalToTrash: reset.defaultUseRecycleBin,
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-6">
      {/* 1. APARIENCIA Y COMPORTAMIENTO */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Apariencia y Comportamiento
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Personaliza el tema visual y las preferencias predeterminadas de tus herramientas.
          </p>
        </div>

        <div className="space-y-6">
          {/* Selector visual de tema */}
          <div>
            <p className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Tema de la interfaz
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = settings.theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isSavingSettings}
                    onClick={() => void setThemeMode(option.id)}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {option.label}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {option.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-sm border border-black/15 dark:border-white/20"
                  style={{ backgroundColor: windowsTheme.accentHex }}
                />
                <span className="text-slate-700 dark:text-slate-300">
                  Color de énfasis de Windows sincronizado automáticamente:{' '}
                  <strong className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {windowsTheme.accentHex}
                  </strong>
                </span>
              </div>
              <span className="text-slate-500 dark:text-slate-400">
                Tema actual del equipo:{' '}
                <strong className="font-semibold text-slate-700 dark:text-slate-200">
                  {windowsTheme.systemPrefersDark ? 'Oscuro' : 'Claro'}
                </strong>
              </span>
            </div>
          </div>

          {/* Inicio automático con Windows (bloqueado en Modo Portable) */}
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Iniciar DiskVault Clean con Windows
                </span>
                {isPortable && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Lock className="h-3.5 w-3.5" />
                    Bloqueado en Portable
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isPortable
                  ? 'Desactivado en Modo Portable para no escribir en el Registro de Windows.'
                  : 'Abre DiskVault Clean automáticamente cuando inicies sesión en tu equipo.'}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={!isPortable && settings.startWithWindows}
              disabled={isPortable || isSavingSettings}
              onClick={() =>
                void updateSettings(
                  { startWithWindows: !settings.startWithWindows },
                  {
                    toastTitle: !settings.startWithWindows
                      ? 'Inicio con Windows activado'
                      : 'Inicio con Windows desactivado',
                  },
                )
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                !isPortable && settings.startWithWindows
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  !isPortable && settings.startWithWindows ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Defaults de NAS y Limpiador */}
          <div className="grid grid-cols-1 gap-5 border-t border-slate-100 pt-5 md:grid-cols-2 dark:border-slate-800">
            <div className="space-y-1.5">
              <label
                htmlFor="nas-default-mode-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Modo predeterminado en Mover al NAS
              </label>
              <select
                id="nas-default-mode-select"
                value={settings.nasDefaultMode}
                disabled={isSavingSettings}
                onChange={(e) => void handleChangeNasDefaultMode(e.target.value as TransferMode)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {NAS_MODE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Días predeterminados de inactividad (Limpiador de Caché)
              </p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
                {INACTIVE_DAY_OPTIONS.map((days) => {
                  const active = settings.defaultInactiveDays === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      disabled={isSavingSettings}
                      onClick={() => void handleChangeDefaultInactiveDays(days)}
                      className={`rounded-md px-3.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                        active
                          ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-800 dark:text-blue-400'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      {days} días
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. SEGURIDAD Y EXCLUSIONES */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Seguridad y Exclusiones
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Define tus protecciones de borrado, programas intocables para la RAM y carpetas que el
            limpiador nunca debe tocar.
          </p>
        </div>

        <div className="space-y-6">
          {/* Switch Modo Administrador permanente por defecto */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Mantener Modo Administrador siempre activo en cada sesión
                </span>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Activo ahora
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {settings.alwaysRunAsAdmin
                  ? 'Activo por defecto: DiskVault Clean se abrirá automáticamente con permisos de Administrador en cada sesión hasta que decidas desactivarlo.'
                  : 'Desactivado: DiskVault Clean se abrirá en modo estándar hasta que vuelvas a activarlo.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.alwaysRunAsAdmin}
              disabled={isSavingSettings || isElevating}
              onClick={() => {
                if (settings.alwaysRunAsAdmin) {
                  void disableAdminMode();
                } else {
                  void requestAdminElevation();
                }
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                settings.alwaysRunAsAdmin
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.alwaysRunAsAdmin ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Switch Papelera de Reciclaje */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Enviar archivos a la Papelera de Reciclaje por defecto
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Recomendado: te permite recuperar archivos si te arrepientes después de limpiar o
                archivar.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.defaultUseRecycleBin}
              disabled={isSavingSettings}
              onClick={() => void handleToggleUseRecycleBin()}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.defaultUseRecycleBin
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.defaultUseRecycleBin ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Switch Confirmar antes de borrado permanente */}
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Pedir confirmación antes de borrados permanentes
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Muestra siempre un aviso de confirmación antes de vaciar la Papelera o borrar sin
                respaldo.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.confirmBeforePermanentDelete}
              disabled={isSavingSettings}
              onClick={() =>
                void updateSettings({
                  confirmBeforePermanentDelete: !settings.confirmBeforePermanentDelete,
                })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.confirmBeforePermanentDelete
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.confirmBeforePermanentDelete ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Procesos protegidos de la liberación de RAM */}
          <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Procesos protegidos de la liberación de RAM
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Agrega juegos, grabadores o reproductores (ej.{' '}
                <span className="font-mono">obs64.exe</span>,{' '}
                <span className="font-mono">vlc.exe</span>,{' '}
                <span className="font-mono">steam.exe</span>) para que nunca sean recortados al
                optimizar la memoria.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newRamProcess}
                onChange={(e) => setNewRamProcess(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddRamProcess();
                  }
                }}
                placeholder="Ej. steam.exe, vlc.exe, obs64.exe"
                className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={isSavingSettings || newRamProcess.trim().length === 0}
                onClick={() => void handleAddRamProcess()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Agregar
              </button>
            </div>

            {settings.ramExcludedProcesses.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {settings.ramExcludedProcesses.map((proc) => (
                  <button
                    key={proc}
                    type="button"
                    onClick={() => void handleRemoveRamProcess(proc)}
                    title={`Quitar ${proc} de la lista`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/60 dark:hover:text-red-300"
                  >
                    <span>{proc}</span>
                    <X className="h-3.5 w-3.5 opacity-70" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Aún no has agregado procesos personalizados. Los procesos críticos de Windows ya
                están protegidos automáticamente.
              </p>
            )}
          </div>

          {/* Carpetas excluidas de la limpieza de caché */}
          <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Carpetas excluidas de la limpieza de caché
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Cualquier carpeta añadida aquí se omitirá por completo al escanear o limpiar
                  cachés.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingSettings}
                onClick={() => void handleAddCleanerExcludedPath()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <FolderPlus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Agregar carpeta...
              </button>
            </div>

            {settings.cleanerExcludedPaths.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {settings.cleanerExcludedPaths.map((folderPath) => (
                  <li
                    key={folderPath}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <span className="truncate font-mono text-slate-700 dark:text-slate-300">
                      {folderPath}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveCleanerExcludedPath(folderPath)}
                      aria-label={`Quitar carpeta ${folderPath}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/60 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                No hay carpetas personalizadas excluidas.
              </p>
            )}
          </div>

          {/* Enlace rápido a destinos NAS */}
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Destinos NAS y discos secundarios
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Edita o prueba tus rutas de red SMB y discos externos guardados.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoToNasTargets}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Administrar destinos NAS guardados
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* 3. REGISTRO DE ACTIVIDAD (AUDITORÍA) Y DATOS */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-6 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Registro de Actividad (Auditoría) y Datos
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Historial completo de acciones ejecutadas por DiskVault Clean en tu equipo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => void handleExportAudit('csv')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              )}
              Exportar historial (CSV)
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => void handleExportAudit('json')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              JSON
            </button>

            <button
              type="button"
              disabled={isOpeningFolder}
              onClick={() => void handleOpenDataFolder()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              Abrir carpeta de datos
            </button>

            <button
              type="button"
              disabled={isCleaningLogs}
              onClick={() => setCleanLogsModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-amber-800 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar historial antiguo (&gt; 30 días)
            </button>
          </div>
        </div>

        {/* Filtros por módulo */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
          {AUDIT_MODULE_FILTERS.map((filter) => {
            const active = moduleFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setModuleFilter(filter.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        {/* Tabla de auditoría */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="py-2.5 pr-3 pl-6">Fecha</th>
                <th className="px-3 py-2.5">Módulo</th>
                <th className="px-3 py-2.5">Acción</th>
                <th className="px-3 py-2.5">Detalle</th>
                <th className="py-2.5 pr-6 pl-3 text-right">Impacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {isLoadingLogs && paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    Cargando historial de actividad...
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    {isTauri
                      ? 'No hay registros de actividad para este filtro.'
                      : 'Ejecuta DiskVault Clean en Windows para ver los registros reales de SQLite.'}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2.5 pr-3 pl-6 font-mono whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(entry.timestamp)}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {formatModuleName(entry.module)}
                    </td>
                    <td className="px-3 py-2.5 font-semibold whitespace-nowrap text-slate-900 dark:text-slate-100">
                      {formatActionName(entry.action)}
                    </td>
                    <td
                      className="max-w-md truncate px-3 py-2.5 text-slate-600 dark:text-slate-400"
                      title={entry.details ?? entry.sourcePath ?? ''}
                    >
                      {entry.details ?? entry.sourcePath ?? '—'}
                    </td>
                    <td className="py-2.5 pr-6 pl-3 text-right font-mono whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                      {entry.bytesAffected > 0 ? formatBytes(entry.bytesAffected) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {filteredLogs.length > LOGS_PER_PAGE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              Mostrando{' '}
              <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                {(safePage - 1) * LOGS_PER_PAGE + 1}–
                {Math.min(safePage * LOGS_PER_PAGE, filteredLogs.length)}
              </span>{' '}
              de{' '}
              <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                {filteredLogs.length}
              </span>{' '}
              registros
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
              <span className="px-2 font-mono">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4. INFORMACIÓN DEL ENTORNO Y MODO DE EJECUCIÓN */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Información del Entorno y Modo de Ejecución
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Diagnóstico de la instancia activa, ubicación local de tus datos y restauración.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {updateInfo?.updateAvailable ? (
              <button
                type="button"
                onClick={openUpdateModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                <Download className="h-3.5 w-3.5" />
                Ver actualización v{updateInfo.latestVersion}
              </button>
            ) : (
              <button
                type="button"
                disabled={isCheckingUpdates}
                onClick={() =>
                  void checkForUpdates({ silent: false, openModalIfAvailable: true })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
              >
                {isCheckingUpdates ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {isCheckingUpdates ? 'Buscando...' : 'Buscar actualizaciones'}
              </button>
            )}

            <button
              type="button"
              disabled={isSavingSettings}
              onClick={() => setResetModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/50 dark:hover:text-red-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar ajustes por defecto
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3 dark:border-slate-800">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Versión de DiskVault Clean</p>
            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
              v{appStatus?.appVersion ?? '1.3.0'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Modo de ejecución</p>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <HardDriveDownload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              {appStatus ? (isPortable ? 'Modo Portable' : 'Modo Instalado') : 'Vista previa web'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Nivel de permisos</p>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAdmin ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Administrador
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  Estándar
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
              <Database className="h-3.5 w-3.5" />
              Base de datos y configuración (SQLite)
            </span>
            <span className="break-all font-mono text-slate-700 dark:text-slate-300">
              {appStatus?.dbPath ?? 'Disponible al ejecutar en Windows (SQLite local)'}
            </span>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              Carpeta de datos activa
            </span>
            <span className="break-all font-mono text-slate-700 dark:text-slate-300">
              {appStatus?.dataDir ?? '—'}
            </span>
          </div>
        </div>
      </section>

      {/* Modal de confirmación: Restaurar ajustes */}
      {resetModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-settings-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs"
          onClick={() => !isSavingSettings && setResetModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="reset-settings-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  ¿Restaurar ajustes por defecto?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Volverán los valores recomendados de tema, Papelera y exclusiones. Tus destinos
                  NAS guardados y el historial de transferencias no se borrarán.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isSavingSettings}
                onClick={() => setResetModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingSettings}
                onClick={() => void handleConfirmResetSettings()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isSavingSettings ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Restaurar ajustes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación: Limpiar historial antiguo */}
      {cleanLogsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clean-logs-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs"
          onClick={() => !isCleaningLogs && setCleanLogsModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="clean-logs-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  ¿Limpiar registros con más de 30 días?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Se eliminarán únicamente las entradas del registro de actividad anteriores a los
                  últimos 30 días. Los registros recientes y tu historial de transferencias NAS se
                  conservarán intactos.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isCleaningLogs}
                onClick={() => setCleanLogsModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isCleaningLogs}
                onClick={() => void handleConfirmCleanOldLogs()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isCleaningLogs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Limpiar antiguos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
