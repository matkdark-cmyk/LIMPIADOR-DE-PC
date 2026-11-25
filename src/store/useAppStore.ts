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
  WindowsThemeInfo,
} from '../types';
import {
  fetchAllSettings,
  fetchAppStatus,
  fetchRecentAuditLogs,
  fetchWindowsTheme,
  invokeAdminElevation,
  invokeApplyNativeWindowTheme,
  invokeDisableAdminMode,
  invokeResetSettingsToDefault,
  invokeSaveSetting,
  invokeUpdateAllSettings,
  isTauriRuntime,
} from '../utils/tauri';
import { applyWindowsAccentToDocument, DEFAULT_WINDOWS_ACCENT } from '../utils/windowsTheme';

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
  alwaysRunAsAdmin: true,
};

const DEFAULT_WINDOWS_THEME_INFO: WindowsThemeInfo = {
  accentHex: DEFAULT_WINDOWS_ACCENT,
  systemPrefersDark: false,
  accentOnTitlebar: false,
};

export function resolveThemeMode(
  mode: ThemeMode,
  systemPrefersDarkOverride?: boolean,
): ResolvedTheme {
  if (mode === 'dark') {
    return 'dark';
  }
  if (mode === 'light') {
    return 'light';
  }
  if (typeof systemPrefersDarkOverride === 'boolean') {
    return systemPrefersDarkOverride ? 'dark' : 'light';
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyThemeToDocument(
  mode: ThemeMode,
  systemPrefersDarkOverride?: boolean,
): ResolvedTheme {
  const resolved = resolveThemeMode(mode, systemPrefersDarkOverride);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
  if (isTauriRuntime()) {
    void invokeApplyNativeWindowTheme(mode).catch(() => {});
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
  windowsTheme: WindowsThemeInfo;
  settings: AppSettings;
  hasLoadedSettings: boolean;
  isSavingSettings: boolean;
  auditLogs: AuditLogEntry[];
  isLoadingLogs: boolean;
  toasts: ToastItem[];

  initializeApp: () => Promise<AppSettings | null>;
  refreshWindowsTheme: () => Promise<void>;
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
  disableAdminMode: () => Promise<void>;
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
  windowsTheme: DEFAULT_WINDOWS_THEME_INFO,
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
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const accentHex = applyWindowsAccentToDocument(DEFAULT_WINDOWS_ACCENT);
      const resolved = applyThemeToDocument(browserTheme, prefersDark);
      const fallbackSettings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        theme: browserTheme,
      };
      set({
        theme: browserTheme,
        resolvedTheme: resolved,
        windowsTheme: {
          accentHex,
          systemPrefersDark: prefersDark,
          accentOnTitlebar: false,
        },
        settings: fallbackSettings,
        hasLoadedSettings: true,
        isLoadingStatus: false,
        appStatus: null,
      });
      return fallbackSettings;
    }

    try {
      const [status, loadedSettings, winThemeRaw] = await Promise.all([
        fetchAppStatus(),
        fetchAllSettings().catch(() => null),
        fetchWindowsTheme().catch(() => DEFAULT_WINDOWS_THEME_INFO),
      ]);

      const accentHex = applyWindowsAccentToDocument(winThemeRaw.accentHex);
      const winTheme: WindowsThemeInfo = {
        ...winThemeRaw,
        accentHex,
      };
      const effectiveTheme: ThemeMode = loadedSettings?.theme ?? status.theme;
      const resolved = applyThemeToDocument(effectiveTheme, winTheme.systemPrefersDark);
      const effectiveSettings: AppSettings = loadedSettings ?? {
        ...DEFAULT_APP_SETTINGS,
        theme: effectiveTheme,
      };

      set({
        appStatus: { ...status, theme: effectiveTheme },
        activeRoute: status.initialRoute,
        theme: effectiveTheme,
        resolvedTheme: resolved,
        windowsTheme: winTheme,
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

  refreshWindowsTheme: async () => {
    if (!isTauriRuntime()) {
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      set((state) => ({
        windowsTheme: { ...state.windowsTheme, systemPrefersDark: prefersDark },
      }));
      if (get().theme === 'system') {
        const resolved = applyThemeToDocument('system', prefersDark);
        set({ resolvedTheme: resolved });
      }
      return;
    }

    try {
      const winThemeRaw = await fetchWindowsTheme();
      const accentHex = applyWindowsAccentToDocument(winThemeRaw.accentHex);
      const winTheme: WindowsThemeInfo = { ...winThemeRaw, accentHex };
      const currentTheme = get().theme;
      const resolved = applyThemeToDocument(currentTheme, winTheme.systemPrefersDark);
      set({
        windowsTheme: winTheme,
        resolvedTheme: resolved,
      });
    } catch {
      // Silencioso si no se pudo consultar el Registro en segundo plano
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
      const resolved = applyThemeToDocument(loaded.theme, get().windowsTheme.systemPrefersDark);
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
    const sysDark = get().windowsTheme.systemPrefersDark;
    const nextResolved = applyThemeToDocument(next.theme, sysDark);

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
      const savedResolved = applyThemeToDocument(saved.theme, get().windowsTheme.systemPrefersDark);
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
      const prevResolved = applyThemeToDocument(previous.theme, get().windowsTheme.systemPrefersDark);
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
    const sysDark = get().windowsTheme.systemPrefersDark;
    if (!get().isTauri) {
      const resolved = applyThemeToDocument(DEFAULT_APP_SETTINGS.theme, sysDark);
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
      const resolved = applyThemeToDocument(reset.theme, sysDark);
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
      dark: 'Modo oscuro activado',
      system: 'Tema sincronizado con Windows',
    };
    await get().updateSettings({ theme: mode }, { toastTitle: labelMap[mode] });
  },

  toggleTheme: async () => {
    const nextTheme: ThemeMode = get().resolvedTheme === 'dark' ? 'light' : 'dark';
    const resolved = applyThemeToDocument(nextTheme, get().windowsTheme.systemPrefersDark);
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
        title: nextTheme === 'dark' ? 'Modo oscuro activado' : 'Tema claro activado',
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
        title: nextTheme === 'dark' ? 'Modo oscuro guardado' : 'Tema claro guardado',
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
    void get().refreshWindowsTheme();
  },

  requestAdminElevation: async () => {
    const { isTauri, activeRoute, appStatus } = get();

    if (!isTauri) {
      set((state) => ({
        settings: { ...state.settings, alwaysRunAsAdmin: true },
      }));
      get().addToast({
        title: 'Elevación UAC disponible solo en Windows',
        message: 'Ejecuta la app de escritorio con Tauri en Windows para solicitar permisos de Administrador.',
        variant: 'warning',
      });
      return;
    }

    if (appStatus?.isAdmin) {
      set((state) => ({
        settings: { ...state.settings, alwaysRunAsAdmin: true },
      }));
      try {
        await invokeAdminElevation(activeRoute);
      } catch {
        // Ya está elevado; ignorar errores secundarios
      }
      get().addToast({
        title: 'Modo Administrador activo en cada sesión',
        message: 'DiskVault Clean mantendrá el Modo Administrador activo hasta que decidas desactivarlo.',
        variant: 'success',
      });
      return;
    }

    set({ isElevating: true });
    try {
      set((state) => ({
        settings: { ...state.settings, alwaysRunAsAdmin: true },
      }));
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

  disableAdminMode: async () => {
    const { isTauri, activeRoute } = get();

    if (!isTauri) {
      set((state) => ({
        settings: { ...state.settings, alwaysRunAsAdmin: false },
      }));
      get().addToast({
        title: 'Modo Administrador desactivado',
        message: 'En escritorio esta preferencia se guardará automáticamente en SQLite.',
        variant: 'info',
      });
      return;
    }

    set({ isElevating: true });
    try {
      const restarted = await invokeDisableAdminMode(activeRoute);
      set((state) => ({
        settings: { ...state.settings, alwaysRunAsAdmin: false },
      }));
      await get().refreshAuditLogs(20);

      if (!restarted) {
        get().addToast({
          title: 'Modo Administrador desactivado',
          message:
            'DiskVault Clean ya no solicitará Modo Administrador automáticamente en próximas sesiones.',
          variant: 'info',
          durationMs: 6000,
        });
      }
    } catch (err) {
      get().addToast({
        title: 'No se pudo desactivar el Modo Administrador',
        message: extractErrorMessage(err),
        variant: 'error',
      });
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
