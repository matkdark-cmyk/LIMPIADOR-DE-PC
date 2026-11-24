use serde::Serialize;
use sysinfo::{DiskKind, Disks, System};

/// Estado de salud visual según el porcentaje de uso del disco.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiskAlertLevel {
    Normal,
    Warning,
    Critical,
}

/// Información resumida de una unidad de almacenamiento montada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount_point: String,
    pub name: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    pub is_removable: bool,
    pub disk_kind: String,
    pub alert_level: DiskAlertLevel,
}

/// Resumen instantáneo de memoria RAM para el Dashboard de Salud.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamOverview {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
}

/// Vista general del estado de discos y RAM del equipo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub disks: Vec<DiskInfo>,
    pub ram: RamOverview,
}

/// Calcula el nivel de alerta según los umbrales definidos (<80% normal, 80-89% warning, >=90% critical).
pub fn compute_disk_alert(usage_percent: f64) -> DiskAlertLevel {
    if usage_percent >= 90.0 {
        DiskAlertLevel::Critical
    } else if usage_percent >= 80.0 {
        DiskAlertLevel::Warning
    } else {
        DiskAlertLevel::Normal
    }
}

/// Obtiene todas las unidades montadas y el estado actual de la memoria RAM.
pub fn collect_system_overview() -> Result<SystemOverview, String> {
    let disks_handle = Disks::new_with_refreshed_list();

    let mut disks: Vec<DiskInfo> = disks_handle
        .list()
        .iter()
        .filter(|disk| disk.total_space() > 0)
        .map(|disk| {
            let total_bytes = disk.total_space();
            let available_bytes = disk.available_space();
            let used_bytes = total_bytes.saturating_sub(available_bytes);
            let usage_percent = if total_bytes > 0 {
                ((used_bytes as f64 / total_bytes as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            };

            let disk_kind = match disk.kind() {
                DiskKind::SSD => "SSD".to_string(),
                DiskKind::HDD => "HDD".to_string(),
                DiskKind::Unknown(_) => "Otro".to_string(),
            };

            let raw_name = disk.name().to_string_lossy().trim().to_string();
            let mount_point = disk.mount_point().to_string_lossy().to_string();
            let name = if raw_name.is_empty() {
                if mount_point.to_uppercase().starts_with("C:") {
                    "Disco Local".to_string()
                } else {
                    "Unidad Local".to_string()
                }
            } else {
                raw_name
            };

            let file_system = disk.file_system().to_string_lossy().to_string();

            DiskInfo {
                mount_point,
                name,
                file_system: if file_system.is_empty() {
                    "Desconocido".to_string()
                } else {
                    file_system
                },
                total_bytes,
                available_bytes,
                used_bytes,
                usage_percent,
                is_removable: disk.is_removable(),
                disk_kind,
                alert_level: compute_disk_alert(usage_percent),
            }
        })
        .collect();

    // Orden estable por letra / punto de montaje (C:\, D:\, E:\...)
    disks.sort_by(|a, b| a.mount_point.to_lowercase().cmp(&b.mount_point.to_lowercase()));

    let mut sys = System::new();
    sys.refresh_memory();

    let ram_total = sys.total_memory();
    let ram_used = sys.used_memory();
    let ram_available = sys.available_memory();
    let ram_usage_percent = if ram_total > 0 {
        ((ram_used as f64 / ram_total as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    Ok(SystemOverview {
        disks,
        ram: RamOverview {
            total_bytes: ram_total,
            used_bytes: ram_used,
            available_bytes: ram_available,
            usage_percent: ram_usage_percent,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{compute_disk_alert, DiskAlertLevel};

    #[test]
    fn clasifica_correctamente_umbrales_de_alerta_de_disco() {
        assert_eq!(compute_disk_alert(42.5), DiskAlertLevel::Normal);
        assert_eq!(compute_disk_alert(79.9), DiskAlertLevel::Normal);
        assert_eq!(compute_disk_alert(80.0), DiskAlertLevel::Warning);
        assert_eq!(compute_disk_alert(89.9), DiskAlertLevel::Warning);
        assert_eq!(compute_disk_alert(90.0), DiskAlertLevel::Critical);
        assert_eq!(compute_disk_alert(98.4), DiskAlertLevel::Critical);
    }
}
