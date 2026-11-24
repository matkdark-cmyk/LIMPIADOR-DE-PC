use crate::scanner::categories::{classify_file, dominant_section, FileSection};
use crate::security;
use jwalk::WalkDir;
use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Cantidad máxima de archivos guardados en Top Global y por Sección.
pub const TOP_FILES_LIMIT: usize = 200;

/// Nodo de archivo o carpeta enviado al frontend bajo demanda.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub section: FileSection,
    pub is_protected: bool,
    pub percent_of_parent: f64,
    pub percent_of_scan: f64,
}

/// Resumen acumulado de una sección de archivos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSummary {
    pub section: FileSection,
    pub label: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub percent_of_scan: f64,
}

/// Evento emitido periódicamente (~150ms) durante el escaneo en curso.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files_scanned: u64,
    pub dirs_scanned: u64,
    pub bytes_scanned: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
}

/// Resumen retornado al finalizar `start_disk_scan`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub root_path: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub skipped_access_denied: u64,
    pub duration_ms: u64,
    pub sections: Vec<SectionSummary>,
    pub root_children: Vec<FileNode>,
    pub top_files: Vec<FileNode>,
}

/// Índice completo mantenido en memoria en Rust para servir carpetas bajo demanda sin saturar IPC.
#[derive(Debug, Clone)]
pub struct ScanIndex {
    pub root_path: String,
    pub root_key: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub skipped_access_denied: u64,
    pub duration_ms: u64,
    pub folder_children: HashMap<String, Vec<FileNode>>,
    pub section_totals: [(u64, u64); 7],
    pub top_files: Vec<FileNode>,
    pub section_top_files: HashMap<FileSection, Vec<FileNode>>,
}

/// Estado administrado por Tauri para el motor de escaneo.
pub struct ScanState {
    pub cancel_flag: Arc<AtomicBool>,
    pub is_scanning: Arc<AtomicBool>,
    pub index: RwLock<Option<ScanIndex>>,
}

impl Default for ScanState {
    fn default() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            is_scanning: Arc::new(AtomicBool::new(false)),
            index: RwLock::new(None),
        }
    }
}

/// Normaliza una ruta para usarla como clave estable en `HashMap` (insensible a mayúsculas y separadores).
pub fn normalize_path_key(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.replace('/', "\\");

    // Si es una letra de unidad sola (ej. "C:"), la convierte en raíz "C:\"
    let bytes = normalized.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        normalized.push('\\');
    }

    // Quita barras finales salvo raíces tipo "C:\" o "\"
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    if normalized.len() == 2 && normalized.ends_with('\\') && !normalized.starts_with("\\\\") {
        // Caso raro tipo "\a\" ya reducido; para "\" len == 1
    }

    normalized.to_lowercase()
}

/// Limpia la ruta de entrada antes de iniciar el escaneo (ej. convierte "C:" en "C:\").
pub fn sanitize_scan_root(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        PathBuf::from(format!("{trimmed}\\"))
    } else {
        PathBuf::from(trimmed)
    }
}

/// Calcula porcentaje con un decimal redondeado de forma segura.
fn compute_percent(part: u64, whole: u64) -> f64 {
    if whole == 0 || part == 0 {
        return 0.0;
    }
    let raw = (part as f64 / whole as f64) * 100.0;
    (raw.min(100.0) * 10.0).round() / 10.0
}

/// Orden estricto de mayor a menor peso, desempatando alfabéticamente por nombre.
pub fn sort_nodes_descending(nodes: &mut [FileNode]) {
    nodes.sort_unstable_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// Elemento interno para mantener un Min-Heap acotado de los N archivos más pesados.
#[derive(Debug, Clone, Eq, PartialEq)]
struct RankedFile {
    size_bytes: u64,
    path: String,
    name: String,
    section: FileSection,
    is_protected: bool,
}

impl Ord for RankedFile {
    fn cmp(&self, other: &Self) -> Ordering {
        // Orden invertido en `size_bytes` para que BinaryHeap actúe como Min-Heap
        other
            .size_bytes
            .cmp(&self.size_bytes)
            .then_with(|| self.path.cmp(&other.path))
    }
}

impl PartialOrd for RankedFile {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn push_top_file(heap: &mut BinaryHeap<RankedFile>, candidate: RankedFile, limit: usize) {
    if heap.len() < limit {
        heap.push(candidate);
    } else if let Some(smallest) = heap.peek() {
        if candidate.size_bytes > smallest.size_bytes {
            heap.pop();
            heap.push(candidate);
        }
    }
}

fn heap_to_sorted_nodes(heap: BinaryHeap<RankedFile>, total_scan_bytes: u64) -> Vec<FileNode> {
    let mut nodes: Vec<FileNode> = heap
        .into_iter()
        .map(|item| FileNode {
            name: item.name,
            path: item.path,
            is_dir: false,
            size_bytes: item.size_bytes,
            file_count: 1,
            dir_count: 0,
            section: item.section,
            is_protected: item.is_protected,
            percent_of_parent: 0.0,
            percent_of_scan: compute_percent(item.size_bytes, total_scan_bytes),
        })
        .collect();
    sort_nodes_descending(&mut nodes);
    nodes
}

/// Agregador temporal por directorio durante el recorrido.
#[derive(Default)]
struct DirAggregate {
    size_bytes: u64,
    file_count: u64,
    dir_count: u64,
    section_bytes: [u64; 7],
}

/// Entrada cruda de hijo directo (archivo o carpeta) registrada durante el recorrido.
struct RawChild {
    name: String,
    path: String,
    key: String,
    is_dir: bool,
    size_bytes: u64,
    section: FileSection,
    is_protected: bool,
}

impl ScanIndex {
    /// Construye el resumen liviano `ScanSummary` para el frontend.
    pub fn to_summary(&self) -> ScanSummary {
        let mut sections: Vec<SectionSummary> = FileSection::ALL
            .iter()
            .map(|&section| {
                let (bytes, count) = self.section_totals[section.index()];
                SectionSummary {
                    section,
                    label: section.label_es().to_string(),
                    total_bytes: bytes,
                    file_count: count,
                    percent_of_scan: compute_percent(bytes, self.total_bytes),
                }
            })
            .collect();

        sections.sort_by(|a, b| {
            b.total_bytes
                .cmp(&a.total_bytes)
                .then_with(|| a.label.cmp(&b.label))
        });

        let root_children = self
            .folder_children
            .get(&self.root_key)
            .cloned()
            .unwrap_or_default();

        ScanSummary {
            root_path: self.root_path.clone(),
            total_bytes: self.total_bytes,
            total_files: self.total_files,
            total_dirs: self.total_dirs,
            skipped_access_denied: self.skipped_access_denied,
            duration_ms: self.duration_ms,
            sections,
            root_children,
            top_files: self.top_files.clone(),
        }
    }

    /// Devuelve los hijos directos ya ordenados de mayor a menor para una carpeta dada.
    pub fn get_children(&self, folder_path: &Path) -> Vec<FileNode> {
        let key = normalize_path_key(folder_path);
        self.folder_children.get(&key).cloned().unwrap_or_default()
    }

    /// Devuelve los archivos más pesados de una sección específica.
    pub fn get_section_files(&self, section: FileSection, limit: usize) -> Vec<FileNode> {
        let clamped = limit.clamp(1, TOP_FILES_LIMIT);
        self.section_top_files
            .get(&section)
            .map(|list| list.iter().take(clamped).cloned().collect())
            .unwrap_or_default()
    }

    /// Busca el tamaño conocido en caché para una ruta antes de eliminarla.
    pub fn find_known_size(&self, target_path: &Path) -> Option<u64> {
        let target_key = normalize_path_key(target_path);
        if target_key == self.root_key {
            return Some(self.total_bytes);
        }
        let parent = target_path.parent()?;
        let parent_key = normalize_path_key(parent);
        let children = self.folder_children.get(&parent_key)?;
        children
            .iter()
            .find(|node| normalize_path_key(Path::new(&node.path)) == target_key)
            .map(|node| node.size_bytes)
    }

    /// Descuenta en memoria un archivo o carpeta enviado a la Papelera sin obligar a re-escanear.
    pub fn remove_deleted_path(&mut self, deleted_path: &Path, fallback_bytes: u64) {
        let target_key = normalize_path_key(deleted_path);
        let parent_key = deleted_path
            .parent()
            .map(normalize_path_key)
            .unwrap_or_default();

        // 1. Elimina el nodo directo de su carpeta padre y recupera sus métricas
        let mut removed_node: Option<FileNode> = None;
        if let Some(siblings) = self.folder_children.get_mut(&parent_key) {
            if let Some(pos) = siblings
                .iter()
                .position(|node| normalize_path_key(Path::new(&node.path)) == target_key)
            {
                removed_node = Some(siblings.remove(pos));
            }
        }

        let (removed_bytes, removed_files, removed_dirs, removed_section, was_dir) =
            if let Some(ref node) = removed_node {
                (
                    node.size_bytes,
                    node.file_count,
                    if node.is_dir {
                        node.dir_count.saturating_add(1)
                    } else {
                        0
                    },
                    node.section,
                    node.is_dir,
                )
            } else {
                (
                    fallback_bytes,
                    1,
                    0,
                    classify_file(deleted_path),
                    false,
                )
            };

        // 2. Si era carpeta, elimina todas las subcarpetas indexadas bajo ella
        if was_dir {
            let prefix_win = format!("{target_key}\\");
            self.folder_children
                .retain(|key, _| key != &target_key && !key.starts_with(&prefix_win));
        }

        // 3. Actualiza totales globales y de sección
        self.total_bytes = self.total_bytes.saturating_sub(removed_bytes);
        self.total_files = self.total_files.saturating_sub(removed_files);
        self.total_dirs = self.total_dirs.saturating_sub(removed_dirs);

        let sec_idx = removed_section.index();
        self.section_totals[sec_idx].0 = self.section_totals[sec_idx].0.saturating_sub(removed_bytes);
        self.section_totals[sec_idx].1 = self.section_totals[sec_idx].1.saturating_sub(removed_files);

        // 4. Descuenta el peso hacia arriba en todos los directorios ancestros
        let mut cursor = deleted_path.parent().map(Path::to_path_buf);
        while let Some(ancestor) = cursor {
            let ancestor_key = normalize_path_key(&ancestor);
            let grand_parent = ancestor.parent().map(Path::to_path_buf);

            if let Some(ref gp) = grand_parent {
                let gp_key = normalize_path_key(gp);
                if let Some(gp_children) = self.folder_children.get_mut(&gp_key) {
                    if let Some(ancestor_node) = gp_children
                        .iter_mut()
                        .find(|n| normalize_path_key(Path::new(&n.path)) == ancestor_key)
                    {
                        ancestor_node.size_bytes =
                            ancestor_node.size_bytes.saturating_sub(removed_bytes);
                        ancestor_node.file_count =
                            ancestor_node.file_count.saturating_sub(removed_files);
                        ancestor_node.dir_count =
                            ancestor_node.dir_count.saturating_sub(removed_dirs);
                    }
                    let gp_total: u64 = gp_children.iter().map(|n| n.size_bytes).sum();
                    for child in gp_children.iter_mut() {
                        child.percent_of_parent = compute_percent(child.size_bytes, gp_total);
                        child.percent_of_scan = compute_percent(child.size_bytes, self.total_bytes);
                    }
                    sort_nodes_descending(gp_children);
                }
            }

            if ancestor_key == self.root_key {
                break;
            }
            cursor = grand_parent;
        }

        // 5. Recalcula porcentajes en el padre directo del elemento borrado
        if let Some(siblings) = self.folder_children.get_mut(&parent_key) {
            let parent_total: u64 = siblings.iter().map(|n| n.size_bytes).sum();
            for child in siblings.iter_mut() {
                child.percent_of_parent = compute_percent(child.size_bytes, parent_total);
                child.percent_of_scan = compute_percent(child.size_bytes, self.total_bytes);
            }
            sort_nodes_descending(siblings);
        }

        // 6. Limpia el elemento (o sus descendientes si era carpeta) de Top Files y listas por sección
        let matches_deleted = |candidate_path: &str| -> bool {
            let key = normalize_path_key(Path::new(candidate_path));
            if key == target_key {
                return true;
            }
            if was_dir {
                let prefix = format!("{target_key}\\");
                return key.starts_with(&prefix);
            }
            false
        };

        self.top_files.retain(|item| !matches_deleted(&item.path));
        for item in &mut self.top_files {
            item.percent_of_scan = compute_percent(item.size_bytes, self.total_bytes);
        }

        for list in self.section_top_files.values_mut() {
            list.retain(|item| !matches_deleted(&item.path));
            for item in list.iter_mut() {
                item.percent_of_scan = compute_percent(item.size_bytes, self.total_bytes);
            }
        }
    }
}

/// Ejecuta el escaneo multi-hilo de forma bloqueante (invocado dentro de `spawn_blocking`).
pub fn execute_disk_scan(
    root_path: PathBuf,
    cancel_flag: Arc<AtomicBool>,
    app_handle: Option<AppHandle>,
) -> Result<ScanIndex, String> {
    if !root_path.exists() {
        return Err(format!(
            "La ruta seleccionada no existe o no está disponible: '{}'.",
            root_path.display()
        ));
    }
    if !root_path.is_dir() {
        return Err(format!(
            "La ruta seleccionada no es una carpeta válida: '{}'.",
            root_path.display()
        ));
    }

    let started = Instant::now();
    let mut last_emit = Instant::now();

    let root_display = root_path.to_string_lossy().to_string();
    let root_key = normalize_path_key(&root_path);

    let mut dir_aggs: HashMap<String, DirAggregate> = HashMap::new();
    dir_aggs.insert(root_key.clone(), DirAggregate::default());

    let mut raw_children: HashMap<String, Vec<RawChild>> = HashMap::new();
    raw_children.insert(root_key.clone(), Vec::new());

    let mut section_totals: [(u64, u64); 7] = [(0, 0); 7];
    let mut global_top_heap: BinaryHeap<RankedFile> = BinaryHeap::with_capacity(TOP_FILES_LIMIT + 1);
    let mut section_heaps: [BinaryHeap<RankedFile>; 7] =
        std::array::from_fn(|_| BinaryHeap::with_capacity(TOP_FILES_LIMIT + 1));

    let mut total_files: u64 = 0;
    let mut total_dirs: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut skipped_access_denied: u64 = 0;
    let mut processed_entries: u64 = 0;

    // Recorrido paralelo con jwalk sin seguir enlaces simbólicos/junctions y sin omitir ocultos.
    let walker = WalkDir::new(&root_path)
        .follow_links(false)
        .skip_hidden(false);

    for entry_res in walker {
        processed_entries += 1;

        if processed_entries % 512 == 0 && cancel_flag.load(AtomicOrdering::Relaxed) {
            return Err("Escaneo cancelado por el usuario.".to_string());
        }

        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => {
                skipped_access_denied += 1;
                continue;
            }
        };

        let entry_path = entry.path();
        let entry_key = normalize_path_key(&entry_path);

        // El directorio raíz no se agrega como hijo de sí mismo
        if entry_key == root_key {
            continue;
        }

        let file_type = entry.file_type();
        // Ignorar enlaces simbólicos / junctions para evitar bucles infinitos o tamaños duplicados
        if file_type.is_symlink() {
            continue;
        }

        let entry_name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let parent_key = match entry_path.parent() {
            Some(parent) => normalize_path_key(parent),
            None => continue,
        };

        if file_type.is_dir() {
            total_dirs += 1;
            dir_aggs.entry(entry_key.clone()).or_default();
            raw_children.entry(entry_key.clone()).or_default();

            let is_protected = security::is_protected_path(&entry_path);
            raw_children.entry(parent_key).or_default().push(RawChild {
                name: entry_name,
                path: entry_path.to_string_lossy().to_string(),
                key: entry_key,
                is_dir: true,
                size_bytes: 0,
                section: FileSection::SystemAndOther,
                is_protected,
            });

            // Acumula el contador de subdirectorios hacia los ancestros hasta la raíz
            let mut ancestor_opt = entry_path.parent();
            while let Some(ancestor) = ancestor_opt {
                let anc_key = normalize_path_key(ancestor);
                let agg = dir_aggs.entry(anc_key.clone()).or_default();
                agg.dir_count += 1;
                if anc_key == root_key {
                    break;
                }
                ancestor_opt = ancestor.parent();
            }
        } else if file_type.is_file() {
            let size_bytes = match entry.metadata() {
                Ok(meta) => meta.len(),
                Err(_) => {
                    skipped_access_denied += 1;
                    continue;
                }
            };

            let section = classify_file(&entry_path);
            let sec_idx = section.index();
            let is_protected = security::is_protected_path(&entry_path);
            let path_display = entry_path.to_string_lossy().to_string();

            total_files += 1;
            total_bytes = total_bytes.saturating_add(size_bytes);
            section_totals[sec_idx].0 = section_totals[sec_idx].0.saturating_add(size_bytes);
            section_totals[sec_idx].1 += 1;

            raw_children.entry(parent_key).or_default().push(RawChild {
                name: entry_name.clone(),
                path: path_display.clone(),
                key: entry_key,
                is_dir: false,
                size_bytes,
                section,
                is_protected,
            });

            // Propaga peso y conteo de archivos hacia cada carpeta ancestro hasta la raíz
            let mut ancestor_opt = entry_path.parent();
            while let Some(ancestor) = ancestor_opt {
                let anc_key = normalize_path_key(ancestor);
                let agg = dir_aggs.entry(anc_key.clone()).or_default();
                agg.size_bytes = agg.size_bytes.saturating_add(size_bytes);
                agg.file_count += 1;
                agg.section_bytes[sec_idx] = agg.section_bytes[sec_idx].saturating_add(size_bytes);
                if anc_key == root_key {
                    break;
                }
                ancestor_opt = ancestor.parent();
            }

            // Actualiza heaps acotados para Top 200 global y Top 200 de su sección
            if size_bytes > 0 {
                let ranked = RankedFile {
                    size_bytes,
                    path: path_display,
                    name: entry_name,
                    section,
                    is_protected,
                };
                push_top_file(&mut section_heaps[sec_idx], ranked.clone(), TOP_FILES_LIMIT);
                push_top_file(&mut global_top_heap, ranked, TOP_FILES_LIMIT);
            }
        }

        // Emisión fluida de progreso cada ~150ms sin saturar IPC
        if let Some(ref handle) = app_handle {
            if last_emit.elapsed() >= Duration::from_millis(150) {
                let _ = handle.emit(
                    "scan-progress",
                    ScanProgress {
                        files_scanned: total_files,
                        dirs_scanned: total_dirs,
                        bytes_scanned: total_bytes,
                        current_path: entry_path.to_string_lossy().to_string(),
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    },
                );
                last_emit = Instant::now();
            }
        }
    }

    if cancel_flag.load(AtomicOrdering::Relaxed) {
        return Err("Escaneo cancelado por el usuario.".to_string());
    }

    // Construcción y ordenamiento paralelo con Rayon de mayor a menor para cada carpeta
    let dir_aggs_ref = &dir_aggs;
    let folder_children: HashMap<String, Vec<FileNode>> = raw_children
        .into_par_iter()
        .map(|(parent_key, children)| {
            let parent_total = dir_aggs_ref
                .get(&parent_key)
                .map(|agg| agg.size_bytes)
                .unwrap_or(0);

            let mut nodes: Vec<FileNode> = children
                .into_iter()
                .map(|child| {
                    if child.is_dir {
                        let agg = dir_aggs_ref.get(&child.key);
                        let dir_size = agg.map(|a| a.size_bytes).unwrap_or(0);
                        let dir_files = agg.map(|a| a.file_count).unwrap_or(0);
                        let sub_dirs = agg.map(|a| a.dir_count).unwrap_or(0);
                        let section = agg
                            .map(|a| dominant_section(&a.section_bytes))
                            .unwrap_or(FileSection::SystemAndOther);

                        FileNode {
                            name: child.name,
                            path: child.path,
                            is_dir: true,
                            size_bytes: dir_size,
                            file_count: dir_files,
                            dir_count: sub_dirs,
                            section,
                            is_protected: child.is_protected,
                            percent_of_parent: compute_percent(dir_size, parent_total),
                            percent_of_scan: compute_percent(dir_size, total_bytes),
                        }
                    } else {
                        FileNode {
                            name: child.name,
                            path: child.path,
                            is_dir: false,
                            size_bytes: child.size_bytes,
                            file_count: 1,
                            dir_count: 0,
                            section: child.section,
                            is_protected: child.is_protected,
                            percent_of_parent: compute_percent(child.size_bytes, parent_total),
                            percent_of_scan: compute_percent(child.size_bytes, total_bytes),
                        }
                    }
                })
                .collect();

            sort_nodes_descending(&mut nodes);
            (parent_key, nodes)
        })
        .collect();

    let top_files = heap_to_sorted_nodes(global_top_heap, total_bytes);

    let mut section_top_files: HashMap<FileSection, Vec<FileNode>> = HashMap::new();
    for (idx, heap) in section_heaps.into_iter().enumerate() {
        let section = FileSection::ALL[idx];
        section_top_files.insert(section, heap_to_sorted_nodes(heap, total_bytes));
    }

    let duration_ms = started.elapsed().as_millis() as u64;

    if let Some(ref handle) = app_handle {
        let _ = handle.emit(
            "scan-progress",
            ScanProgress {
                files_scanned: total_files,
                dirs_scanned: total_dirs,
                bytes_scanned: total_bytes,
                current_path: root_display.clone(),
                elapsed_ms: duration_ms,
            },
        );
    }

    Ok(ScanIndex {
        root_path: root_display,
        root_key,
        total_bytes,
        total_files,
        total_dirs,
        skipped_access_denied,
        duration_ms,
        folder_children,
        section_totals,
        top_files,
        section_top_files,
    })
}

#[cfg(test)]
mod tests {
    use super::{execute_disk_scan, sort_nodes_descending, FileNode};
    use crate::scanner::categories::FileSection;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn make_dummy_node(name: &str, size_bytes: u64) -> FileNode {
        FileNode {
            name: name.to_string(),
            path: format!(r"C:\Test\{name}"),
            is_dir: false,
            size_bytes,
            file_count: 1,
            dir_count: 0,
            section: FileSection::SystemAndOther,
            is_protected: false,
            percent_of_parent: 0.0,
            percent_of_scan: 0.0,
        }
    }

    #[test]
    fn ordena_estrictamente_de_mayor_a_menor_por_tamano() {
        let mut nodes = vec![
            make_dummy_node("pequeno.txt", 120),
            make_dummy_node("gigante.mkv", 5_000_000),
            make_dummy_node("mediano.zip", 45_000),
            make_dummy_node("beta.bin", 45_000),
            make_dummy_node("alfa.bin", 45_000),
        ];

        sort_nodes_descending(&mut nodes);

        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "gigante.mkv",
                "alfa.bin",
                "beta.bin",
                "mediano.zip",
                "pequeno.txt",
            ]
        );
    }

    #[test]
    fn escanea_carpeta_temporal_calcula_totales_y_actualiza_al_borrar() {
        let temp_root = std::env::temp_dir().join(format!(
            "diskvault_scan_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        let sub_videos = temp_root.join("Videos");
        let sub_docs = temp_root.join("Documentos");
        fs::create_dir_all(&sub_videos).unwrap();
        fs::create_dir_all(&sub_docs).unwrap();

        let big_video = sub_videos.join("pelicula.mp4");
        let small_doc = sub_docs.join("notas.pdf");
        fs::write(&big_video, vec![1u8; 4096]).unwrap();
        fs::write(&small_doc, vec![2u8; 512]).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let mut index = execute_disk_scan(temp_root.clone(), cancel, None).unwrap();

        assert_eq!(index.total_bytes, 4608);
        assert_eq!(index.total_files, 2);

        let summary = index.to_summary();
        assert_eq!(summary.root_children[0].name, "Videos");
        assert_eq!(summary.root_children[0].size_bytes, 4096);
        assert_eq!(summary.root_children[1].name, "Documentos");
        assert_eq!(summary.root_children[1].size_bytes, 512);
        assert_eq!(summary.top_files[0].name, "pelicula.mp4");

        // Simula la deducción en memoria tras enviar el video a la Papelera
        index.remove_deleted_path(&big_video, 4096);
        assert_eq!(index.total_bytes, 512);
        assert_eq!(index.total_files, 1);

        let updated = index.to_summary();
        assert_eq!(updated.root_children[0].name, "Documentos");
        assert_eq!(updated.top_files.len(), 1);
        assert_eq!(updated.top_files[0].name, "notas.pdf");

        let _ = fs::remove_dir_all(&temp_root);
    }
}
