## Novedades de DiskVault Clean v1.3.1

- **Corrección definitiva del auto-actualizador y reinicio automático**:
  - Ahora la actualización instala directamente en la misma carpeta y alcance exacto de tu instalación (`/ALLUSERS` o `/CURRENTUSER` + `/D=`) solicitando permisos UAC antes de cerrar la app solo cuando es necesario.
  - Verifica automáticamente que el ejecutable quedó actualizado a la última versión (sincronizando accesos directos si existían dos carpetas) y relanza la nueva ventana automáticamente sin quedar cerrado ni caer en bucles de actualización.
  - Guarda un registro local en `updater.log` para diagnóstico y limpia archivos temporales `.old` al iniciar.
- **Modo Administrador siempre activo por defecto**: DiskVault Clean inicia automáticamente en **Modo Administrador** en cada sesión hasta que decidas desactivarlo manualmente desde la barra superior o desde Ajustes.
- **Escaneo antivirus y Paso 2 (`xxHash3`) bajo tu control en Mover al NAS**:
  - Si eliges **No escanear (salta Paso 2 xxHash3)**, copia todo directamente sin escaneo ni verificación xxHash3.
  - Si se detecta una amenaza o una advertencia en el Paso 2 (`xxHash3`), te vuelve a consultar si deseas **ignorar la advertencia y seguir con el proceso** o **aceptar la advertencia y detenerte hasta ahí**.
- **Colores nativos de Windows y Modo Oscuro**: sincronización automática con el tema Claro/Oscuro y el color de énfasis real de Windows.
