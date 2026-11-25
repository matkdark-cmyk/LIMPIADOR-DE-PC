## Novedades de DiskVault Clean v1.3.2

- **Nuevo auto-actualizador 100% nativo en Rust (cero PowerShell)**:
  - Se eliminó completamente la dependencia de scripts PowerShell temporales (que Windows Defender o antivirus podían bloquear silenciosamente dejando la app cerrada sin actualizar).
  - Ahora el propio binario nativo descarga con barra de progreso visible (`0% -> 100%`), verifica la firma SHA-256, instala en la ruta exacta de tu acceso directo (con respaldo automático directo si el instalador NSIS falla) y abre automáticamente la ventana nueva ya en la última versión.
  - Ejecución en hilos del sistema independientes de Tokio para evitar cierres inesperados al iniciar la descarga.
- **Modo Administrador siempre activo por defecto**: inicia automáticamente con privilegios de Administrador en cada sesión hasta que decidas desactivarlo manualmente.
- **Escaneo antivirus y Paso 2 (`xxHash3`) bajo tu control en Mover al NAS**:
  - Al elegir **No escanear (salta Paso 2 xxHash3)** copia todo directamente sin escaneo ni verificación xxHash3.
  - Ante cualquier amenaza o advertencia del Paso 2 (`xxHash3`), te vuelve a consultar si deseas **ignorar la advertencia y seguir con el proceso** o **aceptar la advertencia y detenerlo hasta ahí**.
- **Colores nativos de Windows y Modo Oscuro**: sincronización automática con el tema Claro/Oscuro y el color de énfasis real de Windows.
