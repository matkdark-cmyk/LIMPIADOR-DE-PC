export type AppRoute =
  | 'dashboard'
  | 'analyzer'
  | 'apps'
  | 'nas'
  | 'cleaner'
  | 'ram'
  | 'settings';

export type ThemeMode = 'system' | 'light' | 'dark';

export type ResolvedTheme = 'light' | 'dark';

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

export interface AppSettings {
  theme: ThemeMode;
  defaultUseRecycleBin: boolean;
  defaultInactiveDays: number;
  confirmBeforePermanentDelete: boolean;
  ramExcludedProcesses: string[];
  cleanerExcludedPaths: string[];
  nasDefaultMode: 'archive_free' | 'move_symlink' | 'copy_backup';
  startWithWindows: boolean;
}

export interface AppStatus {
  isAdmin: boolean;
  isPortable: boolean;
  dataDir: string;
  logsDir: string;
  dbPath: string;
  dbConnected: boolean;
  appVersion: string;
  initialRoute: AppRoute;
  theme: ThemeMode;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  module: string;
  action: string;
  sourcePath: string | null;
  destPath: string | null;
  bytesAffected: number;
  status: string;
  details: string | null;
}

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  durationMs?: number;
}

export interface RouteMeta {
  id: AppRoute;
  label: string;
  title: string;
  subtitle: string;
  stepNumber: number;
  requiresAdminForActions: boolean;
  description: string;
  highlights: string[];
}
