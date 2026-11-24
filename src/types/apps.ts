export type AppInstallType = 'win32' | 'uwp';

export interface InstalledApp {
  id: string;
  name: string;
  publisher: string | null;
  version: string | null;
  installLocation: string | null;
  displayIcon: string | null;
  iconDataUrl: string | null;
  uninstallString: string | null;
  quietUninstallString: string | null;
  estimatedSizeBytes: number;
  realSizeBytes: number | null;
  installDate: string | null;
  lastUsedTimestamp: string | null;
  registryHive: string | null;
  registrySubkey: string | null;
  appType: AppInstallType;
  packageFullName: string | null;
  isRelocated: boolean;
  relocatedTarget: string | null;
  canRelocate: boolean;
  relocateDisabledReason: string | null;
}

export interface AppMetadataUpdate {
  appId: string;
  realSizeBytes: number | null;
  lastUsedTimestamp: string | null;
  iconDataUrl: string | null;
}

export interface AppsScanComplete {
  totalProcessed: number;
}

export interface RunningProcessInfo {
  pid: number;
  name: string;
  exePath: string;
  memoryBytes: number;
}

export interface UninstallExecutionResult {
  appId: string;
  appName: string;
  exitCode: number | null;
  completed: boolean;
  message: string;
}

export type LeftoverItemType = 'folder' | 'file' | 'registry';
export type LeftoverRisk = 'safe' | 'review';

export interface LeftoverItem {
  id: string;
  path: string;
  itemType: LeftoverItemType;
  sizeBytes: number;
  risk: LeftoverRisk;
  reason: string;
  registryHive: string | null;
  registryKeyPath: string | null;
}

export interface LeftoverCleanRequest {
  path: string;
  itemType: LeftoverItemType;
  registryHive: string | null;
  registryKeyPath: string | null;
}

export interface LeftoverCleanResult {
  cleanedCount: number;
  failedCount: number;
  bytesFreed: number;
  errors: string[];
}

export interface RelocatePreflight {
  appId: string;
  appName: string;
  sourcePath: string;
  resolvedDestPath: string;
  sizeBytes: number;
  requiredBytes: number;
  destFreeBytes: number;
  fitsInDestination: boolean;
  destAlreadyExists: boolean;
  requiresAdmin: boolean;
  isAdmin: boolean;
  runningProcesses: RunningProcessInfo[];
}

export type AppFilterKey =
  | 'all'
  | 'heaviest'
  | 'unused30'
  | 'unused90'
  | 'win32'
  | 'uwp'
  | 'relocated';

export type AppSortKey = 'size' | 'name' | 'oldest';
