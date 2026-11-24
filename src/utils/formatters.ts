import type { AppRoute, RouteMeta } from '../types';

export {
  buildPathBreadcrumbs,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSpeed,
  getRelativeDisplayPath,
  SECTION_VISUALS,
} from './format';

/**
 * Formatea tiempo restante estimado (ETA) en segundos a una lectura humana clara.
 */
export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) {
    return 'Calculando...';
  }
  if (etaSeconds < 60) {
    return `${Math.max(1, Math.round(etaSeconds))} s`;
  }
  const mins = Math.floor(etaSeconds / 60);
  const secs = Math.round(etaSeconds % 60);
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Traduce el modo de transferencia NAS a español natural.
 */
export function formatTransferMode(mode: string): string {
  const labels: Record<string, string> = {
    archive_free: 'Archivar y liberar espacio',
    move_symlink: 'Mover con enlace transparente',
    copy_backup: 'Solo respaldar (copia segura)',
  };
  return labels[mode] ?? mode;
}

/**
 * Traduce nombres internos de módulos de auditoría a texto natural en español.
 */
export function formatModuleName(moduleKey: string): string {
  const labels: Record<string, string> = {
    system: 'Sistema',
    uac: 'Permisos UAC',
    settings: 'Ajustes',
    analyzer: 'Explorador de Espacio',
    apps: 'Aplicaciones',
    nas: 'Mover al NAS',
    cleaner: 'Limpieza de Caché',
    ram: 'Memoria RAM',
  };
  return labels[moduleKey] ?? moduleKey;
}

/**
 * Traduce acciones internas de auditoría a descripciones humanas claras.
 */
export function formatActionName(actionKey: string): string {
  const labels: Record<string, string> = {
    app_started: 'Inicio de aplicación',
    elevation_requested: 'Solicitud de Administrador',
    elevation_cancelled_or_failed: 'Elevación cancelada',
    setting_updated: 'Preferencia guardada',
    trash_delete: 'Enviado a Papelera',
    nas_target_saved: 'Destino NAS guardado',
    nas_transfer_completed: 'Migración verificada (xxHash3)',
    nas_transfer_aborted: 'Migración detenida (origen intacto)',
    uninstall: 'Aplicación desinstalada',
    clean_leftovers: 'Residuos de app limpiados',
    relocate_app: 'Aplicación movida a otro disco',
    relocate_app_aborted: 'Reubicación detenida (app intacta)',
    cache_clean: 'Limpieza de caché completada',
    cache_cleanup: 'Limpieza de caché completada',
    optimize_ram: 'Memoria RAM optimizada',
    auto_optimize_ram: 'Auto-optimización de RAM',
    close_app: 'Aplicación cerrada desde RAM',
    settings_updated: 'Ajustes guardados',
    settings_reset: 'Ajustes restaurados',
    audit_exported: 'Historial exportado',
    audit_cleaned: 'Historial antiguo limpiado',
  };
  return labels[actionKey] ?? actionKey;
}

/**
 * Formatea una fecha ISO en tiempo relativo natural en español (ej. "Hoy", "Hace 12 días", "Hace 4 meses").
 */
export function formatRelativeTimeEs(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return 'Sin datos';
  }
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Sin datos';
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return 'Hoy';
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    return 'Hoy';
  }
  if (diffDays === 1) {
    return 'Ayer';
  }
  if (diffDays < 30) {
    return `Hace ${diffDays} días`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) {
    return 'Hace 1 mes';
  }
  if (diffMonths < 12) {
    return `Hace ${diffMonths} meses`;
  }
  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? 'Hace 1 año' : `Hace ${diffYears} años`;
}

/**
 * Formatea una fecha YYYY-MM-DD de instalación a formato legible en español (ej. "14 mar 2025").
 */
export function formatInstallDateEs(dateStr: string | null): string {
  if (!dateStr) {
    return '—';
  }
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }
  return parsed.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calcula los días transcurridos desde una fecha ISO; devuelve `null` si no existe.
 */
export function getDaysSinceIso(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));
}

/**
 * Catálogo maestro de rutas y textos en español claro para la barra lateral y el encabezado.
 */
export const ROUTE_CATALOG: Record<AppRoute, RouteMeta> = {
  dashboard: {
    id: 'dashboard',
    label: 'Inicio',
    title: 'Inicio',
    subtitle: 'Salud de tus discos, consumo actual de memoria RAM y accesos directos de limpieza.',
    stepNumber: 1,
    requiresAdminForActions: false,
    description: 'Resumen central de salud del sistema y diagnóstico de la instancia.',
    highlights: [],
  },
  analyzer: {
    id: 'analyzer',
    label: 'Explorador de Espacio',
    title: 'Explorador de Espacio',
    subtitle: 'Descubre al instante qué carpetas y archivos ocupan más espacio, ordenados de mayor a menor.',
    stepNumber: 2,
    requiresAdminForActions: false,
    description:
      'Escaneo multi-hilo nativo en Rust capaz de analizar cientos de miles de archivos sin congelar la pantalla, ordenado de mayor a menor y clasificado por categorías.',
    highlights: [
      'Árbol de carpetas ordenado por peso real y mapa visual de espacio.',
      'Lista de Top Archivos Pesados y clasificación automática (Videos, Juegos, Documentos, Instaladores).',
      'Protección automática de carpetas críticas de Windows y envío seguro a la Papelera de Reciclaje.',
    ],
  },
  apps: {
    id: 'apps',
    label: 'Aplicaciones',
    title: 'Aplicaciones',
    subtitle: 'Desinstala programas con limpieza de residuos o muévelos a otro disco sin romper accesos.',
    stepNumber: 4,
    requiresAdminForActions: true,
    description:
      'Inventario real desde el Registro de Windows con cálculo exacto de peso en disco, detección de carpetas residuales tras desinstalar y reubicación segura con enlaces NTFS.',
    highlights: [
      'Cálculo del tamaño real en disco de cada programa y juego instalado.',
      'Escáner de archivos sobrantes después de ejecutar el desinstalador oficial.',
      'Reubicación inteligente a otro disco creando enlaces NTFS (Junctions) sin reinstalar.',
    ],
  },
  nas: {
    id: 'nas',
    label: 'Mover al NAS',
    title: 'Mover al NAS',
    subtitle: 'Traslada carpetas grandes a tu NAS o a otro disco verificando cada archivo con xxHash3.',
    stepNumber: 3,
    requiresAdminForActions: false,
    description:
      'Asistente de migración en 3 fases pensado para carpetas pesadas: copia por bloques con progreso en vivo, verificación criptográfica xxHash3 y limpieza local condicionada.',
    highlights: [
      'Fase 1: Copia por streaming con velocidad MB/s, tiempo estimado, pausa y reintento automático ante microcortes.',
      'Fase 2: Comprobación exacta de conteo, bytes y hash xxHash3 entre origen local y destino NAS.',
      'Fase 3: Nunca borra nada en tu PC si falla un solo archivo o existe la mínima diferencia de integridad.',
    ],
  },
  cleaner: {
    id: 'cleaner',
    label: 'Limpieza de Caché',
    title: 'Limpieza de Caché',
    subtitle: 'Elimina archivos temporales, cachés de navegadores y restos innecesarios con semáforo de seguridad.',
    stepNumber: 5,
    requiresAdminForActions: true,
    description:
      'Detección inteligente de cachés de Windows, navegadores, shaders de videojuegos y restos de aplicaciones que ya no utilizas, clasificados por nivel de riesgo.',
    highlights: [
      'Semáforo claro: Seguro (verde), Revisar (amarillo) y Protegido (rojo bloqueado).',
      'Limpieza profunda de carpetas del sistema bajo demanda con Modo Administrador.',
      'Registro automático en el historial de auditoría con los megabytes recuperados.',
    ],
  },
  ram: {
    id: 'ram',
    label: 'Memoria RAM',
    title: 'Memoria RAM',
    subtitle: 'Supervisa el consumo en tiempo real y libera memoria retenida por procesos en segundo plano.',
    stepNumber: 6,
    requiresAdminForActions: true,
    description:
      'Monitor en vivo con gráfica de uso de memoria física, procesos agrupados de forma comprensible y herramientas nativas de Windows para recuperar RAM disponible.',
    highlights: [
      'Gráfica en tiempo real de RAM usada, en espera (Standby) y disponible.',
      'Lista de aplicaciones agrupadas sin nombres técnicos confusos.',
      'Optimización de Working Set y purga de Standby List cuando el Modo Administrador está activo.',
    ],
  },
  settings: {
    id: 'settings',
    label: 'Ajustes',
    title: 'Ajustes',
    subtitle: 'Personaliza el comportamiento, revisa el almacenamiento de datos y consulta el historial completo.',
    stepNumber: 7,
    requiresAdminForActions: false,
    description:
      'Panel central de preferencias persistidas en SQLite, comportamiento de la Papelera, gestión del modo Portable/Instalado y exportación de registros de auditoría.',
    highlights: [
      'Preferencias de tema visual, confirmaciones de seguridad y límites de escaneo.',
      'Consulta y filtrado del historial completo de auditoría local.',
      'Información detallada de la instalación o carpeta portable activa.',
    ],
  },
};

export const PRIMARY_NAV_ROUTES: AppRoute[] = [
  'dashboard',
  'analyzer',
  'apps',
  'nas',
  'cleaner',
  'ram',
];
