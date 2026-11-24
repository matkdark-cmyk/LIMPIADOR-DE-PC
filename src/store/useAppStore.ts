import { create } from 'zustand';
import type {
  AppRoute,
  AppSettings,
  AppStatus,
  AuditLogEntry,
  ResolvedTheme,
  ThemeMode,
  ToastItem,
  ToastVariant,
} from '../types';
import {
  fetchAllSettings,
  fetchAppStatus,
  fetchRecentAuditLogs,
  invokeAdminElevation,
  invokeResetSettingsToDefault,
  invokeSaveSetting,
  invokeUpdateAllSettings,
  isTauriRuntime,
} from '../utils/tauri';

const LOCAL_THEME_KEY = 'diskvault_theme_preview';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  defaultUseRecycleBin: true,
  defaultInactiveDays: 30,
  confirmBeforePermanentDelete: true,
  ramExcludedProcesses: [],
  cleanerExcludedPaths: [],
  nasDefaultMode: 'archive_free',
  startWithWindows: false,
};

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'dark') {
    return 'dark';
  }
  if (mode === 'light') {
    return 'light';
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyThemeToDocument(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveThemeMode(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
  return resolved;
}

function getInitialBrowserTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const saved = window.localStorage.getItem(LOCAL_THEME_KEY);
  if (saved === 'dark' || saved === 'light' || saved === 'system') {
    return saved;
  }
  return 'system';
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al comunicarse con el sistema.';
}

const initialBrowserTheme = getInitialBrowserTheme();

interface AppStoreState {
  activeRoute: AppRoute;
  isTauri: boolean;
  appStatus: AppStatus | null;
  isLoadingStatus: boolean;
  statusError: string | null;
  isElevating: boolean;
  uacBannerDismissed: boolean;
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
  hasLoadedSettings: boolean;
  isSavingSettings: boolean;
  auditLogs: AuditLogEntry[];
  isLoadingLogs: boolean;
  toasts: ToastItem[];

  initializeApp: () => Promise<AppSettings | null>;
  refreshDiagnostics: () => Promise<void>;
  refreshAuditLogs: (limit?: number) => Promise<void>;
  loadSettings: () => Promise<AppSettings | null>;
  updateSettings: (
    patch: Partial<AppSettings>,
    options?: { silentToast?: boolean; toastTitle?: string },
  ) => Promise<AppSettings | null>;
  resetSettings: () => Promise<AppSettings | null>;
  setActiveRoute: (route: AppRoute) => void;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  syncSystemTheme: () => void;
  requestAdminElevation: () => Promise<void>;
  dismissUacBanner: () => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  activeRoute: 'dashboard',
  isTauri: isTauriRuntime(),
  appStatus: null,
  isLoadingStatus: true,
  statusError: null,
  isElevating: false,
  uacBannerDismissed: false,
  theme: initialBrowserTheme,
  resolvedTheme: resolveThemeMode(initialBrowserTheme),
  settings: { ...DEFAULT_APP_SETTINGS, theme: initialBrowserTheme },
  hasLoadedSettings: false,
  isSavingSettings: false,
  auditLogs: [],
  isLoadingLogs: false,
  toasts: [],

  initializeApp: async () => {
    const runningInTauri = isTauriRuntime();
    set({ isTauri: runningInTauri, isLoadingStatus: true, statusError: null });

    if (!runningInTauri) {
      const browserTheme = getInitialBrowserTheme();
      const resolved = applyThemeToDocument(browserTheme);
      const fallbackSettings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        theme: browserTheme,
      };
      set({
        theme: browserTheme,
        resolvedTheme: resolved,
        settings: fallbackSettings,
        hasLoadedSettings: true,
        isLoadingStatus: false,
        appStatus: null,
      });
      return fallbackSettings;
    }

    try {
      const [status, loadedSettings] = await Promise.all([
        fetchAppStatus(),
        fetchAllSettings().catch(() => null),
      ]);

      const effectiveTheme: ThemeMode = loadedSettings?.theme ?? status.theme;
      const resolved = applyThemeToDocument(effectiveTheme);
      const effectiveSettings: AppSettings = loadedSettings ?? {
        ...DEFAULT_APP_SETTINGS,
        theme: effectiveTheme,
      };

      set({
        appStatus: { ...status, theme: effectiveTheme },
        activeRoute: status.initialRoute,
        theme: effectiveTheme,
        resolvedTheme: resolved,
        settings: effectiveSettings,
        hasLoadedSettings: true,
        isLoadingStatus: false,
        statusError: null,
      });

      await get().refreshAuditLogs(20);
      return effectiveSettings;
    } catch (err) {
      const message = extractErrorMessage(err);
      set({
        isLoadingStatus: false,
        statusError: message,
      });
      get().addToast({
        title: 'No se pudo cargar el diagnóstico inicial',
        message,
        variant: 'error',
      });
      return null;
    }
  },

  refreshDiagnostics: async () => {
    if (!get().isTauri) {
      get().addToast({
        title: 'Motor nativo no conectado',
        message: 'Ejecuta la aplicación en Windows con "npm run tauri dev" para leer el estado real.',
        variant: 'info',
      });
      return;
    }

    set({ isLoadingStatus: true, statusError: null });
    try {
      const status = await fetchAppStatus();
      set({
        appStatus: status,
        isLoadingStatus: false,
      });
      await get().refreshAuditLogs(20);
      get().addToast({
        title: 'Diagnóstico actualizado',
        message: 'Se verificó el estado de SQLite, rutas de almacenamiento y permisos.',
        variant: 'success',
      });
    } catch (err) {
      const message = extractErrorMessage(err);
      set({ isLoadingStatus: false, statusError: message });
      get().addToast({
        title: 'Error al actualizar el diagnóstico',
        message,
        variant: 'error',
      });
    }
  },

  refreshAuditLogs: async (limit = 20) => {
    if (!get().isTauri) {
      return;
    }
    set({ isLoadingLogs: true });
    try {
      const logs = await fetchRecentAuditLogs(limit);
      set({ auditLogs: logs, isLoadingLogs: false });
    } catch (err) {
      set({ isLoadingLogs: false });
      get().addToast({
        title: 'No se pudo leer el historial de actividad',
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },

  loadSettings: async () => {
    if (!get().isTauri) {
      return get().settings;
    }
    try {
      const loaded = await fetchAllSettings();
      const resolved = applyThemeToDocument(loaded.theme);
      set((state) => ({
        settings: loaded,
        theme: loaded.theme,
        resolvedTheme: resolved,
        hasLoadedSettings: true,
        appStatus: state.appStatus ? { ...state.appStatus, theme: loaded.theme } : null,
      }));
      return loaded;
    } catch (err) {
      get().addToast({
        title: 'No se pudieron cargar los ajustes',
        message: extractErrorMessage(err),
        variant: 'error',
      });
      return null;
    }
  },

  updateSettings: async (patch, options) => {
    const previous = get().settings;
    const next: AppSettings = { ...previous, ...patch };
    const nextResolved = applyThemeToDocument(next.theme);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCAL_THEME_KEY, next.theme);
    }

    set((state) => ({
      settings: next,
      theme: next.theme,
      resolvedTheme: nextResolved,
      isSavingSettings: true,
      appStatus: state.appStatus ? { ...state.appStatus, theme: next.theme } : null,
    }));

    if (!get().isTauri) {
      set({ isSavingSettings: false });
      if (!options?.silentToast) {
        get().addToast({
          title: options?.toastTitle ?? 'Preferencia actualizada',
          message: 'En escritorio esta preferencia se guardará automáticamente en SQLite.',
          variant: 'info',
        });
      }
      return next;
    }

    try {
      const saved = await invokeUpdateAllSettings(next);
      const savedResolved = applyThemeToDocument(saved.theme);
      set((state) => ({
        settings: saved,
        theme: saved.theme,
        resolvedTheme: savedResolved,
        isSavingSettings: false,
        appStatus: state.appStatus ? { ...state.appStatus, theme: saved.theme } : null,
      }));
      void get().refreshAuditLogs(100);
      if (!options?.silentToast) {
        get().addToast({
          title: options?.toastTitle ?? 'Ajustes guardados',
          message: 'Los cambios quedaron guardados en tu base de datos local.',
          variant: 'success',
        });
      }
      return saved;
    } catch (err) {
      const prevResolved = applyThemeToDocument(previous.theme);
      set((state) => ({
        settings: previous,
        theme: previous.theme,
        resolvedTheme: prevResolved,
        isSavingSettings: false,
        appStatus: state.appStatus ? { ...state.appStatus, theme: previous.theme } : null,
      }));
      get().addToast({
        title: 'No se pudieron guardar los ajustes',
        message: extractErrorMessage(err),
        variant: 'error',
      });
      return null;
    }
  },

  resetSettings: async () => {
    if (!get().isTauri) {
      const resolved = applyThemeToDocument(DEFAULT_APP_SETTINGS.theme);
      set({
        settings: { ...DEFAULT_APP_SETTINGS },
        theme: DEFAULT_APP_SETTINGS.theme,
        resolvedTheme: resolved,
      });
      get().addToast({
        title: 'Ajustes restaurados',
        message: 'Se restablecieron los valores predeterminados.',
        variant: 'success',
      });
      return { ...DEFAULT_APP_SETTINGS };
    }

    set({ isSavingSettings: true });
    try {
      const reset = await invokeResetSettingsToDefault();
      const resolved = applyThemeToDocument(reset.theme);
      set((state) => ({
        settings: reset,
        theme: reset.theme,
        resolvedTheme: resolved,
        isSavingSettings: false,
        appStatus: state.appStatus ? { ...state.appStatus, theme: reset.theme } : null,
      }));
      void get().refreshAuditLogs(100);
      get().addToast({
        title: 'Ajustes restaurados por defecto',
        message: 'Todas las preferencias volvieron a sus valores seguros iniciales.',
        variant: 'success',
      });
      return reset;
    } catch (err) {
      set({ isSavingSettings: false });
      get().addToast({
        title: 'No se pudieron restaurar los ajustes',
        message: extractErrorMessage(err),
        variant: 'error',
      });
      return null;
    }
  },

  setActiveRoute: (route) => {
    set({ activeRoute: route });
  },

  setThemeMode: async (mode) => {
    const labelMap: Record<ThemeMode, string> = {
      light: 'Tema claro activado',
      dark: 'Tema oscuro activado',
      system: 'Tema sincronizado con Windows',
    };
    await get().updateSettings({ theme: mode }, { toastTitle: labelMap[mode] });
  },

  toggleTheme: async () => {
    const nextTheme: ThemeMode = get().resolvedTheme === 'dark' ? 'light' : 'dark';
    const resolved = applyThemeToDocument(nextTheme);
    set((state) => ({
      theme: nextTheme,
      resolvedTheme: resolved,
      settings: { ...state.settings, theme: nextTheme },
    }));

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCAL_THEME_KEY, nextTheme);
    }

    if (!get().isTauri) {
      get().addToast({
        title: nextTheme === 'dark' ? 'Tema oscuro activado' : 'Tema claro activado',
        message: 'En escritorio esta preferencia se guardará automáticamente en SQLite.',
        variant: 'info',
      });
      return;
    }

    try {
      await invokeSaveSetting('theme', nextTheme);
      set((state) => ({
        appStatus: state.appStatus
          ? { ...state.appStatus, theme: nextTheme }
          : null,
      }));
      await get().refreshAuditLogs(20);
      get().addToast({
        title: nextTheme === 'dark' ? 'Tema oscuro guardado' : 'Tema claro guardado',
        message: 'Tu preferencia visual quedó guardada en la base de datos local.',
        variant: 'success',
      });
    } catch (err) {
      get().addToast({
        title: 'No se pudo guardar el tema en SQLite',
        message: extractErrorMessage(err),
        variant: 'error',
      });
    }
  },

  syncSystemTheme: () => {
    const { theme } = get();
    if (theme === 'system') {
      const resolved = applyThemeToDocument('system');
      set({ resolvedTheme: resolved });
    }
  },

  requestAdminElevation: async () => {
    const { isTauri, activeRoute, appStatus } = get();
    if (appStatus?.isAdmin) {
      get().addToast({
        title: 'Modo Administrador ya activo',
        message: 'DiskVault Clean ya cuenta con permisos elevados.',
        variant: 'info',
      });
      return;
    }

    if (!isTauri) {
      get().addToast({
        title: 'Elevación UAC disponible solo en Windows',
        message: 'Ejecuta la app de escritorio con Tauri en Windows para solicitar permisos de Administrador.',
        variant: 'warning',
      });
      return;
    }

    set({ isElevating: true });
    try {
      await invokeAdminElevation(activeRoute);
    } catch (err) {
      const message = extractErrorMessage(err);
      const isCancelled = message.toLowerCase().includes('cancel');
      const variant: ToastVariant = isCancelled ? 'warning' : 'error';

      get().addToast({
        title: isCancelled ? 'Solicitud UAC cancelada' : 'No se pudo activar Modo Administrador',
        message,
        variant,
        durationMs: 6500,
      });
      await get().refreshAuditLogs(20);
    } finally {
      set({ isElevating: false });
    }
  },

  dismissUacBanner: () => {
    set({ uacBannerDismissed: true });
  },

  addToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const durationMs = toast.durationMs ?? 4800;
    const newToast: ToastItem = { ...toast, id, durationMs };

    set((state) => ({
      toasts: [...state.toasts.slice(-3), newToast],
    }));

    if (durationMs > 0) {
      window.setTimeout(() => {
        get().removeToast(id);
      }, durationMs);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    }));
  },
}));
