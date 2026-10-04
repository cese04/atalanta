// Oculta la consola en Windows al compilar en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod book;
mod chapters;
mod kobo;

/// Lo llama la interfaz (ui/app.js) para abrir un libro.
#[tauri::command]
async fn open_book(path: String) -> Result<book::Book, String> {
    book::open(&path)
}

/// Subrayados de la base de datos de un Kobo (ver kobo.rs).
#[tauri::command]
async fn kobo_highlights(path: String) -> Result<Vec<kobo::Clip>, String> {
    kobo::highlights(&path)
}

/// Capítulo de cada cita de un libro, buscándolo en unas carpetas (ver chapters.rs).
#[tauri::command]
async fn find_chapters(title: String, quotes: Vec<String>, dirs: Vec<String>) -> Vec<String> {
    chapters::find(&title, &quotes, &dirs)
}

/// Lee un archivo de texto (las notas). Si no existe, devuelve "".
#[tauri::command]
fn read_text(path: String) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Escribe un archivo de texto (las notas), creando las carpetas que falten.
#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_book, kobo_highlights, find_chapters, read_text, write_text])
        .run(tauri::generate_context!())
        .expect("error al iniciar FastRead");
}
