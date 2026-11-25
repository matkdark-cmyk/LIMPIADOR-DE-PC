## Novedades de DiskVault Clean v1.3.0

- **Modo Administrador siempre activo por defecto**: DiskVault Clean inicia automáticamente en **Modo Administrador** en cada sesión y recuerda tu estado hasta que decidas desactivarlo manualmente desde la barra superior o desde Ajustes.
- **Escaneo antivirus y Paso 2 (`xxHash3`) controlados por el usuario en Mover al NAS**:
  - Si eliges **No escanear, copiar todo**, el sistema también salta automáticamente el Paso 2 (`xxHash3`) y copia todo el contenido seleccionado al disco de respaldo o al NAS.
  - Si eliges escanear y se detecta una amenaza o una advertencia en el Paso 2 (`xxHash3`), la aplicación te vuelve a consultar si deseas **ignorar la advertencia y seguir con el proceso** o **aceptar la advertencia y detenerte hasta ahí** (manteniendo tu carpeta original intacta).
- **Colores nativos de Windows y Modo Oscuro**: sincronización automática con el tema Claro/Oscuro y el color de énfasis real de Windows, más selector rápido **Claro / Oscuro / Windows** en la barra superior.
