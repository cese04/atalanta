// Oculta la consola en Windows al compilar en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod book;
mod chapters;
mod cover;
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

/// Capítulo de cada cita de un libro y su resumen, buscándolo en unas carpetas (ver chapters.rs).
#[tauri::command]
async fn find_chapters(title: String, quotes: Vec<String>, dirs: Vec<String>) -> chapters::Found {
    chapters::find(&title, &quotes, &dirs)
}

/// Portada de un libro EPUB o MOBI (ver cover.rs); vacía si no tiene.
#[tauri::command]
async fn book_cover(path: String) -> tauri::ipc::Response {
    tauri::ipc::Response::new(cover::cover(&path).unwrap_or_default())
}

/// Escribe un archivo binario (la miniatura de una portada), creando las carpetas que falten.
#[tauri::command]
async fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Lee un archivo binario: un PDF, que se procesa en la interfaz con pdf.js (ver ui/pdf-reader.js).
#[tauri::command]
async fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![open_book, kobo_highlights, find_chapters, book_cover, read_bytes, write_bytes, read_text, write_text])
        .run(tauri::generate_context!())
        .expect("error al iniciar FastRead");
}
