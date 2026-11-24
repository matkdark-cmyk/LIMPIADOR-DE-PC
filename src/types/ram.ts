export interface RamMetrics {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  cachedStandbyBytes: number;
  commitUsedBytes: number;
  commitLimitBytes: number;
}

export interface ChildProcessInfo {
  pid: number;
  name: string;
  memoryBytes: number;
}

export interface GroupedAppProcess {
  groupKey: string;
  displayName: string;
  exePath: string | null;
  totalMemoryBytes: number;
  percentOfRam: number;
  processCount: number;
  isSystemCritical: boolean;
  isSelf: boolean;
  children: ChildProcessInfo[];
}

export interface RamSnapshot {
  metrics: RamMetrics;
  processes: GroupedAppProcess[];
  isAdmin: boolean;
  timestamp: string;
}

export interface RamOptimizeResult {
  before: RamMetrics;
  after: RamMetrics;
  freedBytes: number;
  standbyFreedBytes: number;
  processesTrimmed: number;
  processesSkipped: number;
  standbyPurged: boolean;
  note: string | null;
  durationMs: number;
}

export interface CloseGroupResult {
  groupName: string;
  closedCount: number;
  failedCount: number;
  blockedCount: number;
  message: string;
}

export interface RamAutoConfig {
  enabled: boolean;
  thresholdPercent: number;
  purgeStandby: boolean;
  cooldownMinutes: number;
}

export interface RamAutoOptimizedEvent {
  freedBytes: number;
  standbyFreedBytes: number;
  beforePercent: number;
  afterPercent: number;
  standbyPurged: boolean;
}

export interface RamHistoryPoint {
  timeLabel: string;
  usagePercent: number;
  usedGb: number;
  availableGb: number;
  standbyGb: number;
}
