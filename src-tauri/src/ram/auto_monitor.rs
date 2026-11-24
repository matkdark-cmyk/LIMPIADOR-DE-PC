use crate::ram::metrics::{read_ram_metrics, RamState};
use crate::ram::optimizer::optimize_ram;
use crate::storage::db::Database;
use crate::storage::settings::load_settings_from_db;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const KEY_ENABLED: &str = "ram_auto_enabled";
const KEY_THRESHOLD: &str = "ram_auto_threshold_percent";
const KEY_PURGE_STANDBY: &str = "ram_auto_purge_standby";
const KEY_COOLDOWN: &str = "ram_auto_cooldown_minutes";

/// Configuración persistida en SQLite para la auto-optimización opcional de RAM en segundo plano.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RamAutoConfig {
    pub enabled: bool,
    pub threshold_percent: u8,
    pub purge_standby: bool,
    pub cooldown_minutes: u32,
}

impl Default for RamAutoConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_percent: 85,
            purge_standby: false,
            cooldown_minutes: 10,
        }
    }
}

impl RamAutoConfig {
    pub fn sanitized(mut self) -> Self {
        self.threshold_percent = self.threshold_percent.clamp(70, 95);
        self.cooldown_minutes = self.cooldown_minutes.clamp(1, 120);
        self
    }
}

/// Evento emitido al frontend cuando el worker automático libera RAM (`ram-auto-optimized`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamAutoOptimizedEvent {
    pub freed_bytes: u64,
    pub standby_freed_bytes: u64,
    pub before_percent: f32,
    pub after_percent: f32,
    pub standby_purged: bool,
}

/// Estado compartido del monitor automático de RAM gestionado por Tauri.
pub struct RamAutoState {
    pub config: Arc<RwLock<RamAutoConfig>>,
    pub last_triggered: Arc<Mutex<Option<Instant>>>,
}

impl RamAutoState {
    pub fn from_config(config: RamAutoConfig) -> Self {
        Self {
            config: Arc::new(RwLock::new(config.sanitized())),
            last_triggered: Arc::new(Mutex::new(None)),
        }
    }
}

/// Regla pura que decide si debe dispararse la auto-optimización respetando umbral y cooldown.
pub fn should_trigger_auto_optimize(
    config: &RamAutoConfig,
    current_usage_percent: f32,
    elapsed_since_last_secs: Option<u64>,
) -> bool {
    if !config.enabled {
        return false;
    }
    if current_usage_percent < f32::from(config.threshold_percent) {
        return false;
    }
    let cooldown_secs = u64::from(config.cooldown_minutes) * 60;
    match elapsed_since_last_secs {
        Some(elapsed) if elapsed < cooldown_secs => false,
        _ => true,
    }
}

pub fn load_auto_config_from_db(db: &Database) -> RamAutoConfig {
    let default = RamAutoConfig::default();

    let enabled = db
        .get_setting(KEY_ENABLED)
        .ok()
        .flatten()
        .map(|v| v == "true" || v == "1")
        .unwrap_or(default.enabled);

    let threshold_percent = db
        .get_setting(KEY_THRESHOLD)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u8>().ok())
        .unwrap_or(default.threshold_percent);

    let purge_standby = db
        .get_setting(KEY_PURGE_STANDBY)
        .ok()
        .flatten()
        .map(|v| v == "true" || v == "1")
        .unwrap_or(default.purge_standby);

    let cooldown_minutes = db
        .get_setting(KEY_COOLDOWN)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(default.cooldown_minutes);

    RamAutoConfig {
        enabled,
        threshold_percent,
        purge_standby,
        cooldown_minutes,
    }
    .sanitized()
}

pub fn save_auto_config_to_db(db: &Database, raw: RamAutoConfig) -> Result<RamAutoConfig, String> {
    let cfg = raw.sanitized();
    db.save_setting(KEY_ENABLED, if cfg.enabled { "true" } else { "false" })?;
    db.save_setting(KEY_THRESHOLD, &cfg.threshold_percent.to_string())?;
    db.save_setting(
        KEY_PURGE_STANDBY,
        if cfg.purge_standby { "true" } else { "false" },
    )?;
    db.save_setting(KEY_COOLDOWN, &cfg.cooldown_minutes.to_string())?;
    Ok(cfg)
}

/// Lanza un worker asíncrono muy liviano (despierta cada 15s). Si `enabled == false` no consulta nada.
pub fn spawn_ram_auto_monitor(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        // Evitar disparo instantáneo en el arranque
        interval.tick().await;

        loop {
            interval.tick().await;

            let (cfg, elapsed_secs) = {
                let auto_state = app_handle.state::<RamAutoState>();
                let cfg = match auto_state.config.read() {
                    Ok(guard) => guard.clone(),
                    Err(_) => continue,
                };
                if !cfg.enabled {
                    continue;
                }
                let elapsed = auto_state
                    .last_triggered
                    .lock()
                    .ok()
                    .and_then(|g| g.map(|instant| instant.elapsed().as_secs()));
                (cfg, elapsed)
            };

            let Ok(metrics) = read_ram_metrics() else {
                continue;
            };

            if !should_trigger_auto_optimize(&cfg, metrics.usage_percent, elapsed_secs) {
                continue;
            }

            // Registrar timestamp antes de ejecutar para respetar el cooldown
            if let Ok(mut last) = app_handle.state::<RamAutoState>().last_triggered.lock() {
                *last = Some(Instant::now());
            }

            let handle_clone = app_handle.clone();
            let purge_standby = cfg.purge_standby;
            let opt_res = tokio::task::spawn_blocking(move || {
                let app_state = handle_clone.state::<AppState>();
                let ram_state = handle_clone.state::<RamState>();
                let user_settings =
                    load_settings_from_db(&app_state.db, app_state.paths.is_portable);
                optimize_ram(
                    purge_standby,
                    &user_settings.ram_excluded_processes,
                    &ram_state,
                )
            })
            .await;

            if let Ok(Ok(res)) = opt_res {
                let total_bytes = res.freed_bytes.saturating_add(res.standby_freed_bytes);
                let app_state = app_handle.state::<AppState>();
                let _ = app_state.db.record_audit_log(
                    "ram",
                    "auto_optimize_ram",
                    None,
                    None,
                    i64::try_from(total_bytes).unwrap_or(i64::MAX),
                    "ok",
                    Some(&format!(
                        "Auto-optimización RAM (umbral {}%): uso pasó de {:.1}% a {:.1}%.",
                        cfg.threshold_percent, res.before.usage_percent, res.after.usage_percent
                    )),
                );

                let _ = app_handle.emit(
                    "ram-auto-optimized",
                    RamAutoOptimizedEvent {
                        freed_bytes: res.freed_bytes,
                        standby_freed_bytes: res.standby_freed_bytes,
                        before_percent: res.before.usage_percent,
                        after_percent: res.after.usage_percent,
                        standby_purged: res.standby_purged,
                    },
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{should_trigger_auto_optimize, RamAutoConfig};

    /// Prueba obligatoria 4: Respeta umbral configurado y bloquea ejecuciones mientras dure el cooldown.
    #[test]
    fn auto_optimizacion_respeta_umbral_y_cooldown() {
        let mut cfg = RamAutoConfig {
            enabled: false,
            threshold_percent: 85,
            purge_standby: false,
            cooldown_minutes: 10,
        };

        // Desactivado nunca dispara
        assert!(!should_trigger_auto_optimize(&cfg, 92.0, None));

        cfg.enabled = true;

        // Por debajo del umbral no dispara
        assert!(!should_trigger_auto_optimize(&cfg, 84.9, None));

        // En o sobre el umbral sin ejecución previa -> dispara
        assert!(should_trigger_auto_optimize(&cfg, 85.0, None));

        // Dentro del cooldown de 10 minutos (600 s) -> bloqueado
        assert!(!should_trigger_auto_optimize(&cfg, 95.0, Some(120)));
        assert!(!should_trigger_auto_optimize(&cfg, 95.0, Some(599)));

        // Una vez superado el cooldown (>= 600 s) -> permite nueva ejecución
        assert!(should_trigger_auto_optimize(&cfg, 88.0, Some(600)));
    }
}
