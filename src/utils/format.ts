import type { FileSection } from '../types';

/**
 * Formatea una cantidad de bytes a una lectura humana clara (B, KB, MB, GB, TB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  const value = bytes / Math.pow(k, index);
  const precision = index === 0 ? 0 : decimals;
  return `${value.toFixed(precision)} ${units[index]}`;
}

/**
 * Formatea duraciones en milisegundos a texto humano breve (ej. "420 ms", "4.2 s", "1m 18s").
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0 ms';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

/**
 * Formatea enteros con separadores de miles según español (ej. 124.580).
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return new Intl.NumberFormat('es-ES').format(Math.round(value));
}

/**
 * Formatea porcentajes con un decimal consistente.
 */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) {
    return '0.0%';
  }
  if (percent < 0.1) {
    return '< 0.1%';
  }
  return `${percent.toFixed(1)}%`;
}

/**
 * Formatea velocidad de transferencia en bytes/segundo.
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 MB/s';
  }
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

/**
 * Formatea marcas de tiempo ISO-8601 a fecha y hora local legible en español.
 */
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Calcula una ruta relativa limpia respecto a la raíz del escaneo.
 */
export function getRelativeDisplayPath(fullPath: string, rootPath: string): string {
  const normFull = fullPath.replace(/\//g, '\\');
  const normRoot = rootPath.replace(/\//g, '\\').replace(/\\+$/, '');
  if (normFull.toLowerCase().startsWith(normRoot.toLowerCase())) {
    const rest = normFull.slice(normRoot.length).replace(/^\\+/, '');
    return rest || normFull;
  }
  return normFull;
}

/**
 * Divide una ruta actual en segmentos navegables de breadcrumb a partir de la raíz del escaneo.
 */
export interface BreadcrumbSegment {
  label: string;
  path: string;
}

export function buildPathBreadcrumbs(
  currentPath: string,
  rootPath: string,
): BreadcrumbSegment[] {
  const cleanRoot = rootPath.trim();
  const cleanCurrent = currentPath.trim();
  if (!cleanRoot) {
    return [];
  }

  const rootNoTrailing = cleanRoot.length > 3 ? cleanRoot.replace(/[\\/]+$/, '') : cleanRoot;
  const segments: BreadcrumbSegment[] = [{ label: rootNoTrailing, path: cleanRoot }];

  const lowerRoot = rootNoTrailing.toLowerCase();
  const lowerCurrent = cleanCurrent.toLowerCase();
  if (!lowerCurrent.startsWith(lowerRoot) || lowerCurrent === lowerRoot) {
    return segments;
  }

  const remainder = cleanCurrent.slice(rootNoTrailing.length).replace(/^[\\/]+/, '');
  if (!remainder) {
    return segments;
  }

  const parts = remainder.split(/[\\/]+/).filter(Boolean);
  let acc = rootNoTrailing.endsWith('\\') ? rootNoTrailing.slice(0, -1) : rootNoTrailing;
  for (const part of parts) {
    acc = `${acc}\\${part}`;
    segments.push({ label: part, path: acc });
  }

  return segments;
}

export interface SectionVisualMeta {
  section: FileSection;
  label: string;
  shortLabel: string;
  barColor: string;
  dotColor: string;
  textColor: string;
  softBg: string;
}

export const SECTION_VISUALS: Record<FileSection, SectionVisualMeta> = {
  AppsAndGames: {
    section: 'AppsAndGames',
    label: 'Aplicaciones y Juegos',
    shortLabel: 'Apps y Juegos',
    barColor: '#2563EB',
    dotColor: 'bg-blue-600 dark:bg-blue-500',
    textColor: 'text-blue-700 dark:text-blue-300',
    softBg: 'bg-blue-50 dark:bg-blue-500/15',
  },
  Videos: {
    section: 'Videos',
    label: 'Videos y Multimedia',
    shortLabel: 'Videos',
    barColor: '#0D9488',
    dotColor: 'bg-teal-600 dark:bg-teal-400',
    textColor: 'text-teal-700 dark:text-teal-300',
    softBg: 'bg-teal-50 dark:bg-teal-500/15',
  },
  Images: {
    section: 'Images',
    label: 'Imágenes y Diseño',
    shortLabel: 'Imágenes',
    barColor: '#D97706',
    dotColor: 'bg-amber-600 dark:bg-amber-400',
    textColor: 'text-amber-700 dark:text-amber-300',
    softBg: 'bg-amber-50 dark:bg-amber-500/15',
  },
  Audio: {
    section: 'Audio',
    label: 'Audio y Música',
    shortLabel: 'Audio',
    barColor: '#0284C7',
    dotColor: 'bg-sky-600 dark:bg-sky-400',
    textColor: 'text-sky-700 dark:text-sky-300',
    softBg: 'bg-sky-50 dark:bg-sky-500/15',
  },
  Documents: {
    section: 'Documents',
    label: 'Documentos y Oficina',
    shortLabel: 'Documentos',
    barColor: '#16A34A',
    dotColor: 'bg-emerald-600 dark:bg-emerald-400',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    softBg: 'bg-emerald-50 dark:bg-emerald-500/15',
  },
  ArchivesAndInstallers: {
    section: 'ArchivesAndInstallers',
    label: 'Comprimidos e Instaladores',
    shortLabel: 'Comprimidos',
    barColor: '#EA580C',
    dotColor: 'bg-orange-600 dark:bg-orange-400',
    textColor: 'text-orange-700 dark:text-orange-300',
    softBg: 'bg-orange-50 dark:bg-orange-500/15',
  },
  SystemAndOther: {
    section: 'SystemAndOther',
    label: 'Sistema, Caché y Otros',
    shortLabel: 'Sistema y Otros',
    barColor: '#64748B',
    dotColor: 'bg-slate-500 dark:bg-slate-400',
    textColor: 'text-slate-700 dark:text-slate-300',
    softBg: 'bg-slate-100 dark:bg-slate-800',
  },
};
