// Oculta la ventana de consola en builds de lanzamiento en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    diskvault_clean_lib::run();
}
