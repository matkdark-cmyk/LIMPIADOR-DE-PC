use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// Registro de auditoría persistido en SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: i64,
    pub timestamp: String,
    pub module: String,
    pub action: String,
    pub source_path: Option<String>,
    pub dest_path: Option<String>,
    pub bytes_affected: i64,
    pub status: String,
    pub details: Option<String>,
}

/// Destino guardado para migraciones (NAS en red SMB/UNC, unidad mapeada o disco secundario).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NasTarget {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub is_network: bool,
    pub created_at: String,
    pub last_tested_at: Option<String>,
    pub last_free_bytes: Option<i64>,
}

/// Registro histórico de una transferencia hacia NAS u otro disco.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferHistoryEntry {
    pub id: i64,
    pub timestamp: String,
    pub source_path: String,
    pub dest_path: String,
    pub mode: String,
    pub files_count: i64,
    pub total_bytes: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub duration_ms: i64,
}

/// Contenedor seguro entre hilos para la conexión SQLite embebida.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Abre (o crea) `diskvault.db` e inicializa el esquema y migraciones seguras.
    pub fn init(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|err| {
            format!(
                "No se pudo abrir la base de datos local '{}': {err}",
                db_path.display()
            )
        })?;

        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                module TEXT NOT NULL,
                action TEXT NOT NULL,
                source_path TEXT,
                dest_path TEXT,
                bytes_affected INTEGER DEFAULT 0,
                status TEXT NOT NULL,
                details TEXT
            );

            CREATE TABLE IF NOT EXISTS nas_targets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                is_network INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_tested_at TEXT,
                last_free_bytes INTEGER
            );

            CREATE TABLE IF NOT EXISTS transfer_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                source_path TEXT NOT NULL,
                dest_path TEXT NOT NULL,
                mode TEXT NOT NULL,
                files_count INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                duration_ms INTEGER NOT NULL
            );
            ",
        )
        .map_err(|err| format!("No se pudo inicializar el esquema de SQLite: {err}"))?;

        // Migración segura para bases de datos creadas en el Paso 1/2
        Self::ensure_column_exists(&conn, "nas_targets", "last_tested_at", "TEXT")?;
        Self::ensure_column_exists(&conn, "nas_targets", "last_free_bytes", "INTEGER")?;

        // Valor por defecto para el tema visual si aún no existe en ajustes.
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            params!["theme", "system"],
        )
        .map_err(|err| format!("No se pudo inicializar la configuración base: {err}"))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Agrega una columna a una tabla existente solo si aún no está presente.
    fn ensure_column_exists(
        conn: &Connection,
        table: &str,
        column: &str,
        col_type: &str,
    ) -> Result<(), String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|err| format!("Error al inspeccionar esquema de '{table}': {err}"))?;

        let existing: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|err| format!("Error al leer columnas de '{table}': {err}"))?
            .filter_map(Result::ok)
            .collect();

        if !existing.iter().any(|name| name == column) {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {col_type}"),
                [],
            )
            .map_err(|err| {
                format!("No se pudo migrar columna '{column}' en tabla '{table}': {err}")
            })?;
        }
        Ok(())
    }

    /// Comprueba que la conexión SQLite responde correctamente.
    pub fn is_healthy(&self) -> bool {
        let guard = match self.conn.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        guard
            .query_row("SELECT 1", [], |row| row.get::<_, i32>(0))
            .is_ok()
    }

    /// Lee una clave de configuración desde la tabla `settings`.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        guard
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| format!("Error al leer la configuración '{key}': {err}"))
    }

    /// Inserta o actualiza una clave de configuración en la tabla `settings`.
    pub fn save_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let trimmed_key = key.trim();
        if trimmed_key.is_empty() {
            return Err("La clave de configuración no puede estar vacía.".to_string());
        }

        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        guard
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![trimmed_key, value],
            )
            .map_err(|err| format!("No se pudo guardar la configuración '{trimmed_key}': {err}"))?;

        Ok(())
    }

    /// Registra una acción en la tabla `audit_logs`.
    #[allow(clippy::too_many_arguments)]
    pub fn record_audit_log(
        &self,
        module: &str,
        action: &str,
        source_path: Option<&str>,
        dest_path: Option<&str>,
        bytes_affected: i64,
        status: &str,
        details: Option<&str>,
    ) -> Result<i64, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let timestamp = Utc::now().to_rfc3339();

        guard
            .execute(
                "INSERT INTO audit_logs (
                    timestamp, module, action, source_path, dest_path, bytes_affected, status, details
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    timestamp,
                    module,
                    action,
                    source_path,
                    dest_path,
                    bytes_affected,
                    status,
                    details
                ],
            )
            .map_err(|err| format!("No se pudo escribir en el registro de auditoría: {err}"))?;

        Ok(guard.last_insert_rowid())
    }

    /// Obtiene los últimos registros de auditoría ordenados del más reciente al más antiguo.
    pub fn get_recent_audit_logs(&self, limit: u32) -> Result<Vec<AuditLogEntry>, String> {
        let clamped_limit = i64::from(limit.clamp(1, 200));

        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let mut stmt = guard
            .prepare(
                "SELECT id, timestamp, module, action, source_path, dest_path, bytes_affected, status, details
                 FROM audit_logs
                 ORDER BY id DESC
                 LIMIT ?1",
            )
            .map_err(|err| format!("No se pudo consultar el historial de auditoría: {err}"))?;

        let rows = stmt
            .query_map(params![clamped_limit], |row| {
                Ok(AuditLogEntry {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    module: row.get(2)?,
                    action: row.get(3)?,
                    source_path: row.get(4)?,
                    dest_path: row.get(5)?,
                    bytes_affected: row.get(6)?,
                    status: row.get(7)?,
                    details: row.get(8)?,
                })
            })
            .map_err(|err| format!("Error al leer filas del historial de auditoría: {err}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|err| format!("Error al decodificar registro de auditoría: {err}"))?,
            );
        }

        Ok(entries)
    }

    /// Obtiene todos los registros de auditoría ordenados del más reciente al más antiguo.
    pub fn get_all_audit_logs(&self) -> Result<Vec<AuditLogEntry>, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let mut stmt = guard
            .prepare(
                "SELECT id, timestamp, module, action, source_path, dest_path, bytes_affected, status, details
                 FROM audit_logs
                 ORDER BY id DESC",
            )
            .map_err(|err| format!("No se pudo consultar el historial completo de auditoría: {err}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AuditLogEntry {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    module: row.get(2)?,
                    action: row.get(3)?,
                    source_path: row.get(4)?,
                    dest_path: row.get(5)?,
                    bytes_affected: row.get(6)?,
                    status: row.get(7)?,
                    details: row.get(8)?,
                })
            })
            .map_err(|err| format!("Error al leer el historial completo de auditoría: {err}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|err| format!("Error al decodificar registro de auditoría: {err}"))?,
            );
        }
        Ok(entries)
    }

    /// Elimina registros de auditoría con más de `keep_last_days` días de antigüedad.
    pub fn clear_old_audit_logs(&self, keep_last_days: u32) -> Result<usize, String> {
        let cutoff = (Utc::now() - chrono::Duration::days(i64::from(keep_last_days))).to_rfc3339();
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let deleted = guard
            .execute(
                "DELETE FROM audit_logs WHERE timestamp < ?1",
                params![cutoff],
            )
            .map_err(|err| format!("No se pudieron limpiar los registros antiguos: {err}"))?;

        Ok(deleted)
    }

    /// Lista todos los destinos NAS / discos guardados ordenados del más reciente al más antiguo.
    pub fn list_nas_targets(&self) -> Result<Vec<NasTarget>, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let mut stmt = guard
            .prepare(
                "SELECT id, name, path, is_network, created_at, last_tested_at, last_free_bytes
                 FROM nas_targets
                 ORDER BY id DESC",
            )
            .map_err(|err| format!("No se pudieron consultar los destinos guardados: {err}"))?;

        let rows = stmt
            .query_map([], |row| {
                let is_net_int: i64 = row.get(3)?;
                Ok(NasTarget {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    is_network: is_net_int != 0,
                    created_at: row.get(4)?,
                    last_tested_at: row.get(5)?,
                    last_free_bytes: row.get(6)?,
                })
            })
            .map_err(|err| format!("Error al leer destinos NAS guardados: {err}"))?;

        let mut targets = Vec::new();
        for row in rows {
            targets.push(row.map_err(|err| format!("Error al decodificar destino NAS: {err}"))?);
        }
        Ok(targets)
    }

    /// Guarda un nuevo destino NAS o disco secundario.
    pub fn save_nas_target(
        &self,
        name: &str,
        path: &str,
        is_network: bool,
    ) -> Result<NasTarget, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let created_at = Utc::now().to_rfc3339();
        let is_net_int: i64 = if is_network { 1 } else { 0 };

        guard
            .execute(
                "INSERT INTO nas_targets (name, path, is_network, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![name, path, is_net_int, created_at],
            )
            .map_err(|err| format!("No se pudo guardar el destino '{name}': {err}"))?;

        let id = guard.last_insert_rowid();
        Ok(NasTarget {
            id,
            name: name.to_string(),
            path: path.to_string(),
            is_network,
            created_at,
            last_tested_at: None,
            last_free_bytes: None,
        })
    }

    /// Actualiza la última fecha de prueba y espacio libre conocido de un destino guardado por ruta.
    pub fn update_nas_target_health(&self, path: &str, free_bytes: u64) -> Result<(), String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let tested_at = Utc::now().to_rfc3339();
        let free_i64 = i64::try_from(free_bytes).unwrap_or(i64::MAX);

        guard
            .execute(
                "UPDATE nas_targets
                 SET last_tested_at = ?1, last_free_bytes = ?2
                 WHERE LOWER(path) = LOWER(?3)",
                params![tested_at, free_i64, path],
            )
            .map_err(|err| format!("No se pudo actualizar el estado del destino NAS: {err}"))?;

        Ok(())
    }

    /// Elimina un destino guardado de SQLite.
    pub fn delete_nas_target(&self, id: i64) -> Result<(), String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        guard
            .execute("DELETE FROM nas_targets WHERE id = ?1", params![id])
            .map_err(|err| format!("No se pudo eliminar el destino guardado: {err}"))?;

        Ok(())
    }

    /// Registra una operación de transferencia completada, fallida o cancelada en `transfer_history`.
    #[allow(clippy::too_many_arguments)]
    pub fn record_transfer_history(
        &self,
        source_path: &str,
        dest_path: &str,
        mode: &str,
        files_count: u64,
        total_bytes: u64,
        status: &str,
        error_message: Option<&str>,
        duration_ms: u64,
    ) -> Result<i64, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let timestamp = Utc::now().to_rfc3339();
        let files_i64 = i64::try_from(files_count).unwrap_or(i64::MAX);
        let bytes_i64 = i64::try_from(total_bytes).unwrap_or(i64::MAX);
        let duration_i64 = i64::try_from(duration_ms).unwrap_or(i64::MAX);

        guard
            .execute(
                "INSERT INTO transfer_history (
                    timestamp, source_path, dest_path, mode, files_count, total_bytes, status, error_message, duration_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    timestamp,
                    source_path,
                    dest_path,
                    mode,
                    files_i64,
                    bytes_i64,
                    status,
                    error_message,
                    duration_i64
                ],
            )
            .map_err(|err| format!("No se pudo guardar el historial de transferencia: {err}"))?;

        Ok(guard.last_insert_rowid())
    }

    /// Obtiene el historial reciente de transferencias al NAS y otros discos.
    pub fn get_transfer_history(&self, limit: u32) -> Result<Vec<TransferHistoryEntry>, String> {
        let clamped_limit = i64::from(limit.clamp(1, 200));

        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let mut stmt = guard
            .prepare(
                "SELECT id, timestamp, source_path, dest_path, mode, files_count, total_bytes, status, error_message, duration_ms
                 FROM transfer_history
                 ORDER BY id DESC
                 LIMIT ?1",
            )
            .map_err(|err| format!("No se pudo consultar el historial de transferencias: {err}"))?;

        let rows = stmt
            .query_map(params![clamped_limit], |row| {
                Ok(TransferHistoryEntry {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    source_path: row.get(2)?,
                    dest_path: row.get(3)?,
                    mode: row.get(4)?,
                    files_count: row.get(5)?,
                    total_bytes: row.get(6)?,
                    status: row.get(7)?,
                    error_message: row.get(8)?,
                    duration_ms: row.get(9)?,
                })
            })
            .map_err(|err| format!("Error al leer el historial de transferencias: {err}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|err| format!("Error al decodificar transferencia: {err}"))?,
            );
        }
        Ok(entries)
    }

    /// Obtiene todo el historial de transferencias al NAS para exportación completa.
    pub fn get_all_transfer_history(&self) -> Result<Vec<TransferHistoryEntry>, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "No se pudo adquirir acceso a la base de datos local.".to_string())?;

        let mut stmt = guard
            .prepare(
                "SELECT id, timestamp, source_path, dest_path, mode, files_count, total_bytes, status, error_message, duration_ms
                 FROM transfer_history
                 ORDER BY id DESC",
            )
            .map_err(|err| format!("No se pudo consultar el historial completo de transferencias: {err}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(TransferHistoryEntry {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    source_path: row.get(2)?,
                    dest_path: row.get(3)?,
                    mode: row.get(4)?,
                    files_count: row.get(5)?,
                    total_bytes: row.get(6)?,
                    status: row.get(7)?,
                    error_message: row.get(8)?,
                    duration_ms: row.get(9)?,
                })
            })
            .map_err(|err| format!("Error al leer el historial completo de transferencias: {err}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(
                row.map_err(|err| format!("Error al decodificar transferencia: {err}"))?,
            );
        }
        Ok(entries)
    }
}
