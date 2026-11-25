import { AnalyzerView } from './components/analyzer/AnalyzerView';
import { InstalledAppsList } from './components/apps/InstalledAppsList';
import { RelocateAppModal } from './components/apps/RelocateAppModal';
import { UninstallModal } from './components/apps/UninstallModal';
import { CleanerView } from './components/cleaner/CleanerView';
import { DashboardView } from './components/dashboard/DashboardView';
import { CloseGuardModal } from './components/layout/CloseGuardModal';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/layout/ToastContainer';
import { UpdateDetailsModal } from './components/layout/UpdateDetailsModal';
import { NasView } from './components/nas/NasView';
import { RamView } from './components/ram/RamView';
import { SettingsView } from './components/settings/SettingsView';
import { useAppInit } from './hooks/useAppInit';
import { useAppsMetadataListener } from './hooks/useAppsMetadataListener';
import { useCleanerProgressListener } from './hooks/useCleanerProgressListener';
import { useRamAutoEventListener } from './hooks/useRamAutoEventListener';
import { useScanProgressListener } from './hooks/useScanProgressListener';
import { useThemeSystemSync } from './hooks/useThemeSystemSync';
import { useTransferProgressListener } from './hooks/useTransferProgressListener';
import { useUpdateListener } from './hooks/useUpdateListener';
import { useWindowCloseGuard } from './hooks/useWindowCloseGuard';
import { useAppStore } from './store/useAppStore';

export default function App() {
  useAppInit();
  useThemeSystemSync();
  useScanProgressListener();
  useTransferProgressListener();
  useAppsMetadataListener();
  useCleanerProgressListener();
  useRamAutoEventListener();
  useUpdateListener();

  const { isGuardOpen, isCancellingAndClosing, dismissGuard, cancelTransferAndExit } =
    useWindowCloseGuard();

  const activeRoute = useAppStore((state) => state.activeRoute);

  const renderActiveView = () => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardView />;
      case 'analyzer':
        return <AnalyzerView />;
      case 'apps':
        return <InstalledAppsList />;
      case 'nas':
        return <NasView />;
      case 'cleaner':
        return <CleanerView />;
      case 'ram':
        return <RamView />;
      case 'settings':
        return <SettingsView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {renderActiveView()}
        </main>
      </div>

      <UninstallModal />
      <RelocateAppModal />
      <CloseGuardModal
        open={isGuardOpen}
        isCancelling={isCancellingAndClosing}
        onWait={dismissGuard}
        onCancelAndExit={() => void cancelTransferAndExit()}
      />
      <UpdateDetailsModal />
      <ToastContainer />
    </div>
  );
}
