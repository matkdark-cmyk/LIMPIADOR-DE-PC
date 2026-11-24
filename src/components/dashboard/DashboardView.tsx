import { UacBanner } from '../layout/UacBanner';
import { DiskCards } from './DiskCards';
import { QuickActions } from './QuickActions';
import { RamSummary } from './RamSummary';
import { RecentActivityPanel } from './RecentActivityPanel';

export function DashboardView() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <UacBanner />

      {/* Salud del sistema: Discos + Medidor de RAM */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <DiskCards />
        </div>
        <div className="lg:col-span-4">
          <RamSummary />
        </div>
      </div>

      {/* 3 Acciones Rápidas principales */}
      <QuickActions />

      {/* Actividad Reciente (últimas 5 acciones + estado del entorno) */}
      <RecentActivityPanel />
    </div>
  );
}
