export type TransferMode = 'archive_free' | 'move_symlink' | 'copy_backup';

export type TransferPhase =
  | 'preparing'
  | 'copying'
  | 'verifying'
  | 'cleaning'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NasTarget {
  id: number;
  name: string;
  path: string;
  isNetwork: boolean;
  createdAt: string;
  lastTestedAt: string | null;
  lastFreeBytes: number | null;
}

export interface NasConnectionStatus {
  reachable: boolean;
  writable: boolean;
  freeBytes: number;
  totalBytes: number;
  isNetwork: boolean;
  message: string;
}

export interface TransferPreflight {
  sourcePath: string;
  sourceName: string;
  isDir: boolean;
  resolvedDestPath: string;
  filesCount: number;
  totalBytes: number;
  destFreeBytes: number;
  destTotalBytes: number;
  fitsInDestination: boolean;
  destAlreadyExists: boolean;
  destIsNetworkUnc: boolean;
}

export interface TransferRequest {
  sourcePath: string;
  destRoot: string;
  mode: TransferMode;
  sendLocalToTrash: boolean;
}

export interface TransferProgress {
  phase: TransferPhase;
  paused: boolean;
  currentFile: string;
  filesCompleted: number;
  filesTotal: number;
  bytesProcessed: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  percent: number;
  retriesCount: number;
}

export interface TransferResult {
  sourcePath: string;
  destPath: string;
  mode: TransferMode;
  filesCount: number;
  totalBytes: number;
  status: string;
  durationMs: number;
  retriesCount: number;
  symlinkCreated: boolean;
  localSpaceFreed: boolean;
  summaryMessage: string;
}

export interface TransferHistoryEntry {
  id: number;
  timestamp: string;
  sourcePath: string;
  destPath: string;
  mode: string;
  filesCount: number;
  totalBytes: number;
  status: string;
  errorMessage: string | null;
  durationMs: number;
}
