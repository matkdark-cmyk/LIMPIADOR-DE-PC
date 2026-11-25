import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type {
  AppRoute,
  AppSettings,
  AppStatus,
  AuditLogEntry,
  CacheCleanResult,
  CacheScanReport,
  CloseGroupResult,
  FileNode,
  FileSection,
  InstalledApp,
  InstallUpdateRequest,
  LeftoverCleanRequest,
  LeftoverCleanResult,
  LeftoverItem,
  NasConnectionStatus,
  NasTarget,
  RamAutoConfig,
  RamOptimizeResult,
  RamSnapshot,
  RelocatePreflight,
  RunningProcessInfo,
  ScanSummary,
  SystemOverview,
  ThemeMode,
  ThreatScanReport,
  TransferHistoryEntry,
  TransferPreflight,
  TransferRequest,
  TransferResult,
  UninstallExecutionResult,
  UpdateCheckResult,
  WindowsThemeInfo,
} from '../types';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const VALID_ROUTES: ReadonlySet<string> = new Set<AppRoute>([
  'dashboard',
  'analyzer',
  'apps',
  'nas',
  'cleaner',
  'ram',
  'settings',
]);

/**
 * Detecta si la aplicación está ejecutándose dentro del contenedor nativo de Tauri v2.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

function normalizeRoute(raw: string): AppRoute {
  return VALID_ROUTES.has(raw) ? (raw as AppRoute) : 'dashboard';
}

function normalizeTheme(raw: string): ThemeMode {
  if (raw === 'dark') {
    return 'dark';
  }
  if (raw === 'light') {
    return 'light';
  }
  return 'system';
}

interface RawAppStatus {
  isAdmin: boolean;
  isPortable: boolean;
  dataDir: string;
  logsDir: string;
  dbPath: string;
  dbConnected: boolean;
  appVersion: string;
  initialRoute: string;
  theme: string;
}

export async function fetchAppStatus(): Promise<AppStatus> {
  const raw = await invoke<RawAppStatus>('get_app_status');
  return {
    ...raw,
    initialRoute: normalizeRoute(raw.initialRoute),
    theme: normalizeTheme(raw.theme),
  };
}

export async function invokeAdminElevation(currentRoute: AppRoute): Promise<void> {
  await invoke<void>('request_admin_elevation', { currentRoute });
}

export async function invokeSaveSetting(key: string, value: string): Promise<void> {
  await invoke<void>('save_setting', { key, value });
}

export async function fetchRecentAuditLogs(limit: number): Promise<AuditLogEntry[]> {
  return invoke<AuditLogEntry[]>('get_recent_audit_logs', { limit });
}

export async function fetchSystemOverview(): Promise<SystemOverview> {
  return invoke<SystemOverview>('get_system_overview');
}

export async function invokeStartDiskScan(rootPath: string): Promise<ScanSummary> {
  return invoke<ScanSummary>('start_disk_scan', { rootPath });
}

export async function invokeCancelDiskScan(): Promise<void> {
  await invoke<void>('cancel_disk_scan');
}

export async function fetchScanSummary(): Promise<ScanSummary | null> {
  return invoke<ScanSummary | null>('get_scan_summary');
}

export async function fetchFolderChildren(folderPath: string): Promise<FileNode[]> {
  return invoke<FileNode[]>('get_folder_children', { folderPath });
}

export async function fetchFilesBySection(
  section: FileSection,
  limit = 200,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('get_files_by_section', { section, limit });
}

export async function invokeOpenInExplorer(path: string): Promise<void> {
  await invoke<void>('open_in_explorer', { path });
}

export async function invokeDeleteItemToTrash(path: string): Promise<number> {
  return invoke<number>('delete_item_to_trash', { path });
}

export async function pickFolderDialog(title = 'Elegir carpeta'): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title,
  });
  if (typeof selected === 'string' && selected.trim().length > 0) {
    return selected;
  }
  return null;
}

export async function saveExportFileDialog(
  defaultPath: string,
  format: 'csv' | 'json',
): Promise<string | null> {
  const selected = await saveDialog({
    title: 'Exportar historial de actividad',
    defaultPath,
    filters:
      format === 'csv'
        ? [{ name: 'Archivo CSV (Excel)', extensions: ['csv'] }]
        : [{ name: 'Archivo JSON', extensions: ['json'] }],
  });
  if (typeof selected === 'string' && selected.trim().length > 0) {
    return selected;
  }
  return null;
}

// ==================== IPC PASO 3: MIGRADOR SEGURO A NAS / OTROS DISCOS ====================

export async function fetchNasTargets(): Promise<NasTarget[]> {
  return invoke<NasTarget[]>('list_nas_targets');
}

export async function invokeSaveNasTarget(name: string, path: string): Promise<NasTarget> {
  return invoke<NasTarget>('save_nas_target', { name, path });
}

export async function invokeDeleteNasTarget(id: number): Promise<void> {
  await invoke<void>('delete_nas_target', { id });
}

export async function invokeTestNasConnection(params: {
  path: string;
  username?: string;
  password?: string;
  rememberInWindows: boolean;
}): Promise<NasConnectionStatus> {
  return invoke<NasConnectionStatus>('test_nas_connection', {
    path: params.path,
    username: params.username?.trim() ? params.username.trim() : null,
    password: params.password ? params.password : null,
    rememberInWindows: params.rememberInWindows,
  });
}

export async function invokePreviewTransferSource(
  sourcePath: string,
  destRoot: string,
): Promise<TransferPreflight> {
  return invoke<TransferPreflight>('preview_transfer_source', {
    sourcePath,
    destRoot,
  });
}

export async function invokeScanTransferThreats(sourcePath: string): Promise<ThreatScanReport> {
  return invoke<ThreatScanReport>('scan_transfer_threats', { sourcePath });
}

export async function invokeRecordThreatDecision(params: {
  sourcePath: string;
  destRoot: string;
  continuedByUser: boolean;
  findingsCount: number;
  summary: string;
}): Promise<void> {
  await invoke<void>('record_threat_decision', params);
}

export async function invokeStartSafeTransfer(
  request: TransferRequest,
): Promise<TransferResult> {
  return invoke<TransferResult>('start_safe_transfer', { request });
}

export async function invokePauseTransfer(): Promise<void> {
  await invoke<void>('pause_transfer');
}

export async function invokeResumeTransfer(): Promise<void> {
  await invoke<void>('resume_transfer');
}

export async function invokeCancelTransfer(): Promise<void> {
  await invoke<void>('cancel_transfer');
}

export async function fetchTransferHistory(limit = 50): Promise<TransferHistoryEntry[]> {
  return invoke<TransferHistoryEntry[]>('get_transfer_history', { limit });
}

// ==================== IPC PASO 4: GESTOR, DESINSTALADOR Y REUBICADOR DE APPS ====================

export async function fetchInstalledApps(includeUwp = true): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>('list_installed_apps', { includeUwp });
}

export async function invokeCheckAppRunningProcesses(
  appId: string,
): Promise<RunningProcessInfo[]> {
  return invoke<RunningProcessInfo[]>('check_app_running_processes', { appId });
}

export async function invokeCloseAppProcesses(pids: number[]): Promise<number> {
  return invoke<number>('close_app_processes', { pids });
}

export async function invokeRunAppUninstaller(
  appId: string,
): Promise<UninstallExecutionResult> {
  return invoke<UninstallExecutionResult>('run_app_uninstaller', { appId });
}

export async function invokeScanAppLeftovers(params: {
  appName: string;
  publisher: string | null;
  oldInstallLocation: string | null;
  registryHive: string | null;
  registrySubkey: string | null;
}): Promise<LeftoverItem[]> {
  return invoke<LeftoverItem[]>('scan_app_leftovers', {
    appName: params.appName,
    publisher: params.publisher,
    oldInstallLocation: params.oldInstallLocation,
    registryHive: params.registryHive,
    registrySubkey: params.registrySubkey,
  });
}

export async function invokeCleanAppLeftovers(
  items: LeftoverCleanRequest[],
  useRecycleBin: boolean,
): Promise<LeftoverCleanResult> {
  return invoke<LeftoverCleanResult>('clean_app_leftovers', {
    items,
    useRecycleBin,
  });
}

export async function invokePreflightRelocateApp(
  appId: string,
  destParentDir: string,
): Promise<RelocatePreflight> {
  return invoke<RelocatePreflight>('preflight_relocate_app', {
    appId,
    destParentDir,
  });
}

export async function invokeExecuteRelocateApp(
  appId: string,
  destParentDir: string,
  closeRunningFirst: boolean,
): Promise<TransferResult> {
  return invoke<TransferResult>('execute_relocate_app', {
    appId,
    destParentDir,
    closeRunningFirst,
  });
}

// ==================== IPC PASO 5: LIMPIADOR DE CACHÉ Y APPS SIN USO ====================

export async function invokeScanCacheTargets(
  inactiveDaysThreshold: number,
): Promise<CacheScanReport> {
  return invoke<CacheScanReport>('scan_cache_targets', { inactiveDaysThreshold });
}

export async function invokeExecuteCacheClean(
  targetIds: string[],
  useRecycleBin: boolean,
  closeRunningApps: boolean,
): Promise<CacheCleanResult> {
  return invoke<CacheCleanResult>('execute_cache_clean', {
    targetIds,
    useRecycleBin,
    closeRunningApps,
  });
}

export async function invokeCloseCleanerBlockingApps(
  processNames: string[],
): Promise<number> {
  return invoke<number>('close_cleaner_blocking_apps', { processNames });
}

// ==================== IPC PASO 6: MONITOR Y LIBERADOR DE MEMORIA RAM ====================

export async function fetchRamSnapshot(): Promise<RamSnapshot> {
  return invoke<RamSnapshot>('get_ram_snapshot');
}

export async function invokeOptimizeRam(
  purgeStandby: boolean,
  excludeGroupKeys: string[] = [],
): Promise<RamOptimizeResult> {
  return invoke<RamOptimizeResult>('optimize_ram', {
    purgeStandby,
    excludeGroupKeys,
  });
}

export async function invokeCloseProcessGroup(
  pids: number[],
  groupName: string,
): Promise<CloseGroupResult> {
  return invoke<CloseGroupResult>('close_process_group', {
    pids,
    groupName,
  });
}

export async function fetchRamAutoConfig(): Promise<RamAutoConfig> {
  return invoke<RamAutoConfig>('get_ram_auto_config');
}

export async function invokeSetRamAutoConfig(
  config: RamAutoConfig,
): Promise<RamAutoConfig> {
  return invoke<RamAutoConfig>('set_ram_auto_config', { config });
}

// ==================== IPC PASO 7: AJUSTES, AUDITORÍA Y PROTECCIÓN DE CIERRE ====================

export async function fetchAllSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_all_settings');
}

export async function invokeUpdateAllSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>('update_all_settings', { settings });
}

export async function invokeResetSettingsToDefault(): Promise<AppSettings> {
  return invoke<AppSettings>('reset_settings_to_default');
}

export async function invokeOpenDataFolder(): Promise<void> {
  await invoke<void>('open_data_folder');
}

export async function invokeExportAuditLogs(
  format: 'csv' | 'json',
  destPath: string,
): Promise<number> {
  return invoke<number>('export_audit_logs', { format, destPath });
}

export async function invokeClearOldAuditLogs(keepLastDays: number): Promise<number> {
  return invoke<number>('clear_old_audit_logs', { keepLastDays });
}

export async function invokeIsCriticalOperationRunning(): Promise<boolean> {
  return invoke<boolean>('is_critical_operation_running');
}

// ==================== IPC AUTO-ACTUALIZACIÓN (GITHUB RELEASES) ====================

export async function invokeCheckForUpdates(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('check_for_updates');
}

export async function invokeDownloadAndInstallUpdate(
  request: InstallUpdateRequest,
): Promise<void> {
  await invoke<void>('download_and_install_update', { request });
}

// ==================== IPC TEMA NATIVO DE WINDOWS ====================

export async function fetchWindowsTheme(): Promise<WindowsThemeInfo> {
  return invoke<WindowsThemeInfo>('get_windows_theme');
}

export async function invokeApplyNativeWindowTheme(mode: ThemeMode): Promise<void> {
  await invoke<void>('apply_native_window_theme', { mode });
}




