import { useScannerStore } from '../../store/useScannerStore';
import type { SectionSummary } from '../../types';
import { formatBytes, formatPercent, SECTION_VISUALS } from '../../utils/format';

interface DiskTreemapProps {
  sections: SectionSummary[];
  totalBytes: number;
}

export function DiskTreemap({ sections, totalBytes }: DiskTreemapProps) {
  const selectSection = useScannerStore((state) => state.selectSection);
  const activeTab = useScannerStore((state) => state.activeTab);
  const selectedSection = useScannerStore((state) => state.selectedSection);

  const nonZeroSections = sections.filter((item) => item.totalBytes > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Distribución por tipo de archivo
        </h3>
        <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
          Total analizado: {formatBytes(totalBytes)}
        </span>
      </div>

      {/* Barra horizontal segmentada proporcional e interactiva */}
      <div
        role="group"
        aria-label="Distribución proporcional por secciones"
        className="flex h-4 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
      >
        {nonZeroSections.length === 0 ? (
          <div className="h-full w-full bg-slate-200 dark:bg-slate-800" />
        ) : (
          nonZeroSections.map((item) => {
            const visual = SECTION_VISUALS[item.section];
            const widthPercent =
              totalBytes > 0 ? Math.max(0.8, (item.totalBytes / totalBytes) * 100) : 0;
            const isHighlighted = activeTab === 'sections' && selectedSection === item.section;

            return (
              <button
                key={item.section}
                type="button"
                onClick={() => void selectSection(item.section, true)}
                title={`${item.label}: ${formatBytes(item.totalBytes)} (${formatPercent(item.percentOfScan)}) — Clic para ver archivos`}
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: visual.barColor,
                }}
                className={`h-full border-r border-white/60 transition-opacity duration-150 last:border-r-0 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-900/70 ${
                  isHighlighted ? 'opacity-100 ring-2 ring-inset ring-white/80' : 'opacity-95'
                }`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
