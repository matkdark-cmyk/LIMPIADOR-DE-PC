// Oculta la ventana de consola en builds de lanzamiento en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(config_path) = diskvault_clean_lib::updater::parse_apply_update_arg() {
        diskvault_clean_lib::updater::run_native_updater_helper(&config_path);
        return;
    }

    diskvault_clean_lib::run();
}
