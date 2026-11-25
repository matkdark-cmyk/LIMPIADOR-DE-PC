import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * Sincroniza automáticamente el tema Claro/Oscuro y el color de énfasis real de Windows
 * tanto al cambiar `prefers-color-scheme` como al volver el foco a la ventana tras
 * modificar la personalización en Configuración de Windows.
 */
export function useThemeSystemSync(): void {
  const theme = useAppStore((state) => state.theme);
  const refreshWindowsTheme = useAppStore((state) => state.refreshWindowsTheme);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleRefresh = () => {
      void refreshWindowsTheme();
    };

    window.addEventListener('focus', handleRefresh);

    let mediaQuery: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', handleRefresh);
    }

    return () => {
      window.removeEventListener('focus', handleRefresh);
      mediaQuery?.removeEventListener('change', handleRefresh);
    };
  }, [theme, refreshWindowsTheme]);
}
