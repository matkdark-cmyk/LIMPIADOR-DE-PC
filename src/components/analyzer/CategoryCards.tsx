import type { ComponentType } from 'react';
import {
  Archive,
  FileText,
  Film,
  Gamepad2,
  HardDrive,
  Image,
  Music,
} from 'lucide-react';
import { useScannerStore } from '../../store/useScannerStore';
import type { FileSection, SectionSummary } from '../../types';
import {
  formatBytes,
  formatNumber,
  formatPercent,
  SECTION_VISUALS,
} from '../../utils/format';

interface IconProps {
  className?: string;
}

const SECTION_ICONS: Record<FileSection, ComponentType<IconProps>> = {
  AppsAndGames: Gamepad2,
  Videos: Film,
  Images: Image,
  Audio: Music,
  Documents: FileText,
  ArchivesAndInstallers: Archive,
  SystemAndOther: HardDrive,
};

interface CategoryCardsProps {
  sections: SectionSummary[];
}

export function CategoryCards({ sections }: CategoryCardsProps) {
  const activeTab = useScannerStore((state) => state.activeTab);
  const selectedSection = useScannerStore((state) => state.selectedSection);
  const selectSection = useScannerStore((state) => state.selectSection);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {sections.map((item) => {
        const Icon = SECTION_ICONS[item.section];
        const visual = SECTION_VISUALS[item.section];
        const isSelected = activeTab === 'sections' && selectedSection === item.section;

        return (
          <button
            key={item.section}
            type="button"
            onClick={() => void selectSection(item.section, true)}
            className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              isSelected
                ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-500/10'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${visual.softBg} ${visual.textColor}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                {formatPercent(item.percentOfScan)}
              </span>
            </div>

            <div className="mt-3">
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200" title={item.label}>
                {visual.shortLabel}
              </p>
              <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatBytes(item.totalBytes)}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {formatNumber(item.fileCount)} archivos
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
