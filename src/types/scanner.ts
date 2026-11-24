export type DiskAlertLevel = 'normal' | 'warning' | 'critical';

export interface DiskInfo {
  mountPoint: string;
  name: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  isRemovable: boolean;
  diskKind: string;
  alertLevel: DiskAlertLevel;
}

export interface RamOverview {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface SystemOverview {
  disks: DiskInfo[];
  ram: RamOverview;
}

export type FileSection =
  | 'AppsAndGames'
  | 'Videos'
  | 'Images'
  | 'Audio'
  | 'Documents'
  | 'ArchivesAndInstallers'
  | 'SystemAndOther';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  fileCount: number;
  dirCount: number;
  section: FileSection;
  isProtected: boolean;
  percentOfParent: number;
  percentOfScan: number;
}

export interface SectionSummary {
  section: FileSection;
  label: string;
  totalBytes: number;
  fileCount: number;
  percentOfScan: number;
}

export interface ScanProgress {
  filesScanned: number;
  dirsScanned: number;
  bytesScanned: number;
  currentPath: string;
  elapsedMs: number;
}

export interface ScanSummary {
  rootPath: string;
  totalBytes: number;
  totalFiles: number;
  totalDirs: number;
  skippedAccessDenied: number;
  durationMs: number;
  sections: SectionSummary[];
  rootChildren: FileNode[];
  topFiles: FileNode[];
}

export type AnalyzerTab = 'tree' | 'top-files' | 'sections';
