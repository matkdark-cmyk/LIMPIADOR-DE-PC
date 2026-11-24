import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * Escucha cambios del tema del sistema operativo (`prefers-color-scheme`)
 * para actualizar instantáneamente la interfaz cuando el tema es "Seguir a Windows".
 */
export function useThemeSystemSync(): void {
  const theme = useAppStore((state) => state.theme);
  const syncSystemTheme = useAppStore((state) => state.syncSystemTheme);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    syncSystemTheme();

    const handleChange = () => {
      syncSystemTheme();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme, syncSystemTheme]);
}
