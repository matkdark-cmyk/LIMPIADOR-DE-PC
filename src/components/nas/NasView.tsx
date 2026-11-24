import { useEffect } from 'react';
import { useNasStore, type NasSectionTab } from '../../store/useNasStore';
import { useScannerStore } from '../../store/useScannerStore';
import { HistoryTable } from './HistoryTable';
import { NasTargetManager } from './NasTargetManager';
import { TransferQueue } from './TransferQueue';
import { TransferWizard } from './TransferWizard';

const NAS_TABS: { id: NasSectionTab; label: string }[] = [
  { id: 'wizard', label: 'Nueva Migración Segura' },
  { id: 'targets', label: 'Destinos NAS y Discos' },
  { id: 'history', label: 'Historial de Transferencias' },
];

export function NasView() {
  const activeSubTab = useNasStore((state) => state.activeSubTab);
  const setActiveSubTab = useNasStore((state) => state.setActiveSubTab);
  const loadTargetsAndHistory = useNasStore((state) => state.loadTargetsAndHistory);
  const setSourcePath = useNasStore((state) => state.setSourcePath);
  const targetsCount = useNasStore((state) => state.targets.length);
  const historyCount = useNasStore((state) => state.history.length);

  const pendingNasSourcePath = useScannerStore((state) => state.pendingNasSourcePath);

  useEffect(() => {
    void loadTargetsAndHistory();
  }, [loadTargetsAndHistory]);

  // Si el usuario llegó haciendo clic en "Mover al NAS" desde el Explorador de Espacio, pre-rellena el origen
  useEffect(() => {
    if (pendingNasSourcePath) {
      setSourcePath(pendingNasSourcePath);
      setActiveSubTab('wizard');
    }
  }, [pendingNasSourcePath, setSourcePath, setActiveSubTab]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Progreso en vivo o resumen de la última operación */}
      <TransferQueue />

      {/* Navegación interna del módulo NAS */}
      <div
        role="tablist"
        aria-label="Secciones de Mover al NAS"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900"
      >
        {NAS_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          const countSuffix =
            tab.id === 'targets' && targetsCount > 0
              ? ` (${targetsCount})`
              : tab.id === 'history' && historyCount > 0
                ? ` (${historyCount})`
                : '';

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveSubTab(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
              {countSuffix}
            </button>
          );
        })}
      </div>

      {activeSubTab === 'wizard' && <TransferWizard />}
      {activeSubTab === 'targets' && <NasTargetManager />}
      {activeSubTab === 'history' && <HistoryTable />}
    </div>
  );
}
