## Novedades de DiskVault Clean v1.4.0

- **Detector automático de archivos nuevos con Notificaciones nativas de Windows**:
  - Supervisa en tiempo real tus carpetas principales (**Descargas**, **Escritorio**, **Documentos**, **Vídeos**, **Imágenes**) y cualquier carpeta adicional que agregues desde **Ajustes**, esperando a que termine cada descarga de internet o copia desde discos duros externos o memorias USB antes de avisarte.
  - Muestra una **notificación nativa en el Centro de Notificaciones de Windows** con botones directos: **Copiar al NAS** y **Solo dejar en PC**.
  - Al elegir **Copiar al NAS**, abre una ventana rápida con todas tus ubicaciones disponibles del NAS o discos de respaldo (o la opción de elegir otra carpeta) para copiar o mover directamente al destino elegido.
  - Incluye botón **Probar notificación de Windows** y filtro de tamaño mínimo en **Ajustes**.
- **Auto-actualizador 100% nativo en Rust (cero PowerShell)**: descarga con progreso visible, verifica SHA-256, instala en la ruta exacta y reinicia automáticamente en la nueva versión.
- **Modo Administrador siempre activo por defecto** hasta que decidas desactivarlo manualmente.
- **Escaneo antivirus y Paso 2 (`xxHash3`) bajo tu control en Mover al NAS** y sincronización automática con el tema Claro/Oscuro y color de énfasis de Windows.
