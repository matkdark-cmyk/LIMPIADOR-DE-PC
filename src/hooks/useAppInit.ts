import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useCleanerStore } from '../store/useCleanerStore';
import { useNasStore } from '../store/useNasStore';
import { useScannerStore } from '../store/useScannerStore';
import type { InactiveDaysOption } from '../types';

function coerceInactiveOption(days: number): InactiveDaysOption {
  if (days <= 15) return 15;
  if (days <= 30) return 30;
  if (days <= 60) return 60;
  return 90;
}

/**
 * Inicializa el estado de la aplicación al montar la interfaz principal,
 * cargando diagnóstico, ajustes consolidados (aplicando defaults a Cleaner y NAS)
 * y resumen de discos/RAM.
 */
export function useAppInit(): void {
  const initializeApp = useAppStore((state) => state.initializeApp);
  const loadSystemOverview = useScannerStore((state) => state.loadSystemOverview);

  useEffect(() => {
    let active = true;

    void initializeApp().then((loadedSettings) => {
      if (!active || !loadedSettings) {
        return;
      }
      // Sincronizar preferencias predeterminadas en Cleaner y NAS al arranque
      useCleanerStore.setState({
        useRecycleBin: loadedSettings.defaultUseRecycleBin,
        inactiveDaysThreshold: coerceInactiveOption(loadedSettings.defaultInactiveDays),
      });
      useNasStore.setState({
        mode: loadedSettings.nasDefaultMode,
        sendLocalToTrash: loadedSettings.defaultUseRecycleBin,
      });
    });

    void loadSystemOverview(true);

    return () => {
      active = false;
    };
  }, [initializeApp, loadSystemOverview]);
}
