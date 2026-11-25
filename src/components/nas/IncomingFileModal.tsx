import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  FileArchive,
  Folder,
  FolderOpen,
  HardDrive,
  Laptop,
  Network,
  Server,
  X,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useAppStore } from '../../store/useAppStore';
import { useNasStore } from '../../store/useNasStore';
import type { TransferMode } from '../../types';
import { formatBytes } from '../../utils/format';
import { invokeOpenInExplorer, isTauriRuntime, pickFolderDialog } from '../../utils/tauri';

export function IncomingFileModal() {
  const activeIncomingFile = useNasStore((s) => s.activeIncomingFile);
  const targets = useNasStore((s) => s.targets);
  const loadTargetsAndHistory = useNasStore((s) => s.loadTargetsAndHistory);
  const closeIncomingFileModal = useNasStore((s) => s.closeIncomingFileModal);
  const keepIncomingFileOnPc = useNasStore((s) => s.keepIncomingFileOnPc);
  const sendIncomingFileToNas = useNasStore((s) => s.sendIncomingFileToNas);
  const addToast = useAppStore((s) => s.addToast);

  const [selectedDest, setSelectedDest] = useState<string>('');
  const [transferMode, setTransferMode] = useState<TransferMode>('copy_backup');
  const [isPickingDest, setIsPickingDest] = useState(false);

  const isOpen = activeIncomingFile !== null;

  useEscapeKey(isOpen, closeIncomingFileModal);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (targets.length === 0 && isTauriRuntime()) {
      void loadTargetsAndHistory();
    }
  }, [isOpen, targets.length, loadTargetsAndHistory]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setTransferMode('copy_backup');
    setSelectedDest((prev) => {
      if (prev && targets.some((t) => t.path === prev)) {
        return prev;
      }
      return targets[0]?.path ?? '';
    });
  }, [isOpen, activeIncomingFile?.id, targets]);

  if (!activeIncomingFile) {
    return null;
  }

  const handlePickCustomDest = async () => {
    if (!isTauriRuntime()) {
      addToast({
        title: 'Selector nativo disponible en Windows',
        message: 'Ejecuta DiskVault Clean en Windows para elegir una carpeta o disco destino.',
        variant: 'info',
      });
      return;
    }
    setIsPickingDest(true);
    try {
      const picked = await pickFolderDialog('Elegir ubicación en tu NAS o disco de respaldo');
      if (picked) {
        setSelectedDest(picked);
      }
    } finally {
      setIsPickingDest(false);
    }
  };

  const handleOpenOriginInExplorer = async () => {
    if (!isTauriRuntime() || activeIncomingFile.isTest) {
      return;
    }
    try {
      await invokeOpenInExplorer(activeIncomingFile.path);
    } catch {
      // Silencioso si el archivo ya fue movido o renombrado
    }
  };

  const isCustomSelected =
    selectedDest.trim().length > 0 && !targets.some((t) => t.path === selectedDest);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-file-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={closeIncomingFileModal}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              {activeIncomingFile.isDir ? (
                <Folder className="h-5 w-5" />
              ) : (
                <FileArchive className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3
                id="incoming-file-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {activeIncomingFile.isDir
                  ? 'Nueva carpeta detectada en tu equipo'
                  : 'Nuevo archivo detectado en tu equipo'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Elige si quieres copiarlo directamente a una de tus ubicaciones del NAS o dejarlo
                solo en este PC.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeIncomingFileModal}
            aria-label="Cerrar ventana"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {/* Resumen del elemento detectado */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {activeIncomingFile.fileName}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>Origen: {activeIncomingFile.originLabel}</span>
                  <span>·</span>
                  <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                    {formatBytes(activeIncomingFile.totalBytes)}
                  </span>
                  {activeIncomingFile.isDir && (
                    <>
                      <span>·</span>
                      <span>{activeIncomingFile.filesCount} archivo(s)</span>
                    </>
                  )}
                </p>
              </div>

              {!activeIncomingFile.isTest && (
                <button
                  type="button"
                  onClick={() => void handleOpenOriginInExplorer()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Abrir ubicación
                </button>
              )}
            </div>

            <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {activeIncomingFile.path}
            </p>
          </div>

          {/* Selección de ubicación NAS / respaldo disponible */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Ubicaciones disponibles del NAS y discos de respaldo
              </p>
              <button
                type="button"
                disabled={isPickingDest}
                onClick={() => void handlePickCustomDest()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Elegir otra carpeta o disco...
              </button>
            </div>

            {targets.length > 0 ? (
              <div className="space-y-2">
                {targets.map((target) => {
                  const selected = selectedDest === target.path;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setSelectedDest(target.path)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                            selected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {target.isNetwork ? (
                            <Network className="h-4 w-4" />
                          ) : (
                            <HardDrive className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {target.name}
                          </p>
                          <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {target.path}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {target.lastFreeBytes !== null && (
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {formatBytes(target.lastFreeBytes)} libres
                          </span>
                        )}
                        {selected && (
                          <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-4 text-center dark:border-slate-700 dark:bg-slate-950/40">
                <Server className="mx-auto h-5 w-5 text-slate-400" />
                <p className="mt-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  Aún no tienes ubicaciones NAS guardadas.
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Puedes elegir una carpeta o disco ahora mismo con el botón superior o guardar tu
                  NAS en la sección Mover al NAS.
                </p>
              </div>
            )}

            {isCustomSelected && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-600 bg-blue-50/70 px-3.5 py-2.5 text-xs dark:border-blue-500 dark:bg-blue-950/40">
                <div className="min-w-0">
                  <p className="font-semibold text-blue-900 dark:text-blue-200">
                    Carpeta personalizada seleccionada
                  </p>
                  <p className="truncate font-mono text-[11px] text-blue-700 dark:text-blue-300">
                    {selectedDest}
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              </div>
            )}
          </div>

          {/* Qué hacer con el archivo en el PC */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              ¿Qué acción deseas realizar?
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTransferMode('copy_backup')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  transferMode === 'copy_backup'
                    ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                }`}
              >
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Copiar al NAS y conservar en PC
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Crea una copia segura en tu NAS sin borrar el archivo local.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTransferMode('archive_free')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  transferMode === 'archive_free'
                    ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                }`}
              >
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Mover al NAS y liberar espacio
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Traslada el contenido al NAS y limpia la copia local al terminar.
                </p>
              </button>
            </div>
          </div>
        </div>

        {/* Pie de acciones */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/70">
          <button
            type="button"
            onClick={() => void keepIncomingFileOnPc(activeIncomingFile.id, false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Laptop className="h-3.5 w-3.5" />
            Solo dejar en PC
          </button>

          <button
            type="button"
            disabled={!selectedDest.trim()}
            onClick={() =>
              void sendIncomingFileToNas(activeIncomingFile, selectedDest, transferMode)
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            <Copy className="h-3.5 w-3.5" />
            {transferMode === 'archive_free'
              ? 'Mover directamente al NAS'
              : 'Copiar directamente al NAS'}
          </button>
        </div>
      </div>
    </div>
  );
}
