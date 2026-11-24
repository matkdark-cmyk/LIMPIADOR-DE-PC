import {
  CheckCircle2,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useNasStore } from '../../store/useNasStore';
import { formatBytes, formatDateTime } from '../../utils/format';
import { isTauriRuntime, pickFolderDialog } from '../../utils/tauri';

export function NasTargetManager() {
  const targets = useNasStore((state) => state.targets);
  const isLoadingTargets = useNasStore((state) => state.isLoadingTargets);
  const testingTargetPath = useNasStore((state) => state.testingTargetPath);
  const lastConnectionTest = useNasStore((state) => state.lastConnectionTest);
  const saveTarget = useNasStore((state) => state.saveTarget);
  const deleteTarget = useNasStore((state) => state.deleteTarget);
  const testConnection = useNasStore((state) => state.testConnection);
  const setDestRoot = useNasStore((state) => state.setDestRoot);
  const setActiveSubTab = useNasStore((state) => state.setActiveSubTab);

  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberInWindows, setRememberInWindows] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const isUncInput = path.trim().startsWith('\\\\') || path.trim().startsWith('//');

  const handleBrowseFolder = async () => {
    if (!isTauriRuntime()) {
      return;
    }
    const picked = await pickFolderDialog('Seleccionar carpeta de destino (NAS o disco)');
    if (picked) {
      setPath(picked);
      if (!name.trim()) {
        const clean = picked.replace(/[\\/]+$/, '');
        const lastPart = clean.split(/[\\/]/).pop();
        if (lastPart) {
          setName(lastPart);
        }
      }
    }
  };

  const handleTestFormPath = async () => {
    if (!path.trim()) {
      return;
    }
    await testConnection({
      path: path.trim(),
      username: showCredentials ? username : undefined,
      password: showCredentials ? password : undefined,
      rememberInWindows,
    });
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !path.trim()) {
      return;
    }
    setIsSaving(true);
    const ok = await saveTarget(name.trim(), path.trim());
    setIsSaving(false);
    if (ok) {
      setName('');
      setPath('');
      setUsername('');
      setPassword('');
      setShowCredentials(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Formulario para agregar y probar un destino NAS o disco secundario */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 pb-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Agregar destino NAS o disco secundario
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Compatible con rutas de red SMB/UNC (<span className="font-mono">\\192.168.1.50\Respaldos</span>),
            unidades mapeadas (<span className="font-mono">Z:\</span>) y discos locales (<span className="font-mono">D:\Backups</span>).
          </p>
        </div>

        <form onSubmit={(e) => void handleSave(e)} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <label
                htmlFor="nas-name-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Nombre amigable
              </label>
              <input
                id="nas-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. NAS Casa — Multimedia"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-8">
              <label
                htmlFor="nas-path-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Ruta de red (UNC) o carpeta local
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="nas-path-input"
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="Ej. \\192.168.1.50\Respaldos o D:\Respaldos"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => void handleBrowseFolder()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Examinar...</span>
                </button>
              </div>
            </div>
          </div>

          {/* Credenciales opcionales SMB (nunca guardadas en SQLite) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <button
              type="button"
              onClick={() => setShowCredentials((prev) => !prev)}
              className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              <span className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                <span>
                  Credenciales de red SMB (opcional — solo si tu NAS pide usuario y contraseña)
                </span>
              </span>
              <span className="text-blue-600 dark:text-blue-400">
                {showCredentials ? 'Ocultar' : 'Configurar'}
              </span>
            </button>

            {showCredentials && (
              <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="smb-user-input"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Usuario SMB
                    </label>
                    <input
                      id="smb-user-input"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Ej. usuario_nas"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="smb-pass-input"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Contraseña SMB
                    </label>
                    <input
                      id="smb-pass-input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={rememberInWindows}
                    onChange={(e) => setRememberInWindows(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Recordar sesión en el Administrador de Credenciales de Windows.{' '}
                    <strong className="font-medium text-slate-700 dark:text-slate-300">
                      DiskVault Clean nunca guarda tu contraseña en SQLite ni en registros.
                    </strong>
                  </span>
                </label>

                {!isUncInput && path.trim().length > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Las credenciales SMB solo se aplican a rutas de red UNC que comienzan con{' '}
                    <span className="font-mono">\\servidor\carpeta</span>.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Resultado en vivo de la prueba de conexión del formulario */}
          {lastConnectionTest &&
            lastConnectionTest.path.toLowerCase() === path.trim().toLowerCase() && (
              <div
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-xs ${
                  lastConnectionTest.status.reachable && lastConnectionTest.status.writable
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
                }`}
              >
                {lastConnectionTest.status.reachable && lastConnectionTest.status.writable ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div className="space-y-0.5">
                  <p className="font-semibold">{lastConnectionTest.status.message}</p>
                  {lastConnectionTest.status.reachable && (
                    <p className="font-mono tabular-nums">
                      Libre: {formatBytes(lastConnectionTest.status.freeBytes)} · Total:{' '}
                      {formatBytes(lastConnectionTest.status.totalBytes)}
                    </p>
                  )}
                </div>
              </div>
            )}

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={!path.trim() || testingTargetPath !== null}
              onClick={() => void handleTestFormPath()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {testingTargetPath === path.trim() ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Probar conexión y permisos</span>
            </button>

            <button
              type="submit"
              disabled={!name.trim() || !path.trim() || isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isSaving ? 'Guardando...' : 'Guardar destino'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Lista de destinos guardados */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Destinos guardados
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Selecciona cualquier destino para usarlo en el asistente o prueba su espacio libre actual.
          </p>
        </div>

        {isLoadingTargets ? (
          <div className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between py-4">
                <div className="h-4 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/70" />
              </div>
            ))}
          </div>
        ) : targets.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Network className="mx-auto h-6 w-6 text-slate-400 dark:text-slate-500" />
            <p className="mt-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              Todavía no tienes destinos NAS o discos guardados
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Agrega tu NAS en red local o un disco externo arriba para reutilizarlo en un clic.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {targets.map((target) => {
              const isTesting = testingTargetPath === target.path;
              return (
                <div
                  key={target.id}
                  className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {target.isNetwork ? (
                        <Network className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <HardDrive className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {target.name}
                        </p>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {target.isNetwork ? 'Red / NAS' : 'Disco local'}
                        </span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-xs text-slate-600 dark:text-slate-400">
                        {target.path}
                      </p>
                      {target.lastFreeBytes !== null && (
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          Espacio libre verificado:{' '}
                          <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                            {formatBytes(target.lastFreeBytes)}
                          </span>
                          {target.lastTestedAt && (
                            <span> · {formatDateTime(target.lastTestedAt)}</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() =>
                        void testConnection({
                          path: target.path,
                          rememberInWindows: false,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      {isTesting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      <span>Probar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDestRoot(target.path);
                        setActiveSubTab('wizard');
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-400"
                    >
                      Usar destino
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteTarget(target.id)}
                      aria-label={`Eliminar destino ${target.name}`}
                      title="Eliminar destino guardado"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
