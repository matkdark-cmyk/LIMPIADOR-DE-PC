export type SafetyLevel = 'safe' | 'review' | 'protected';

export type CacheGroup =
  | 'windows_system'
  | 'browsers'
  | 'graphics_shaders'
  | 'inactive_apps'
  | 'recycle_bin';

export type InactiveDaysOption = 15 | 30 | 60 | 90;

export interface CacheTarget {
  id: string;
  group: CacheGroup;
  name: string;
  description: string;
  safety: SafetyLevel;
  requiresAdmin: boolean;
  paths: string[];
  sizeBytes: number;
  fileCount: number;
  isLockedByRunningApp: boolean;
  runningProcessNames: string[];
  defaultSelected: boolean;
  inactiveDays: number | null;
  skipRecentMinutes: number | null;
  filePrefixFilter: string | null;
  serviceToPause: string | null;
  directDeleteOnly: boolean;
}

export interface CacheScanProgress {
  currentGroup: string;
  scannedTargets: number;
  totalTargets: number;
  bytesFound: number;
}

export interface CacheScanReport {
  totalReclaimableBytes: number;
  safeReclaimableBytes: number;
  reviewReclaimableBytes: number;
  adminLockedBytes: number;
  targets: CacheTarget[];
  durationMs: number;
  isAdmin: boolean;
  inactiveDaysThreshold: number;
}

export interface CacheCleanProgress {
  currentTargetName: string;
  targetsDone: number;
  targetsTotal: number;
  bytesFreedSoFar: number;
}

export interface PerTargetCleanResult {
  targetId: string;
  targetName: string;
  bytesFreed: number;
  filesDeleted: number;
  filesSkippedInUse: number;
  status: 'ok' | 'partial' | 'skipped' | 'error';
  message: string;
}

export interface CacheCleanResult {
  bytesFreed: number;
  filesDeleted: number;
  filesSkippedInUse: number;
  perTargetResults: PerTargetCleanResult[];
  durationMs: number;
  wuauservRestarted: boolean;
}
