import { Copy, FolderOpen, Server, Trash2 } from 'lucide-react';
import { useScannerStore } from '../../store/useScannerStore';
import type { FileNode } from '../../types';

interface RowQuickActionsProps {
  node: FileNode;
}

export function RowQuickActions({ node }: RowQuickActionsProps) {
  const openInExplorer = useScannerStore((state) => state.openInExplorer);
  const copyPathToClipboard = useScannerStore((state) => state.copyPathToClipboard);
  const sendPathToNas = useScannerStore((state) => state.sendPathToNas);
  const requestTrashDelete = useScannerStore((state) => state.requestTrashDelete);

  const buttonBase =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => void openInExplorer(node.path)}
        title="Abrir ubicación en el Explorador de Windows"
        aria-label={`Abrir ubicación de ${node.name}`}
        className={buttonBase}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => void copyPathToClipboard(node.path)}
        title="Copiar ruta completa"
        aria-label={`Copiar ruta de ${node.name}`}
        className={buttonBase}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        disabled={node.isProtected}
        onClick={() => sendPathToNas(node.path)}
        title={
          node.isProtected
            ? 'Elemento protegido del sistema'
            : 'Mover al NAS o a otro disco con verificación xxHash3'
        }
        aria-label={`Mover ${node.name} al NAS`}
        className={`${buttonBase} disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-500`}
      >
        <Server className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        disabled={node.isProtected}
        onClick={() => requestTrashDelete(node)}
        title={
          node.isProtected
            ? 'Elemento protegido del sistema'
            : 'Enviar a la Papelera de Reciclaje de Windows'
        }
        aria-label={`Enviar ${node.name} a la Papelera`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:text-slate-400 dark:hover:bg-red-500/15 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
