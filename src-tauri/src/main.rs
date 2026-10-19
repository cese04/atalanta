// Oculta la consola en Windows al compilar en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Comandos que la interfaz (ui/) llama con invoke(). La lógica está en el crate core.
use fastread_core::notes::{Clip, Info};
use fastread_core::{book, cover, kindle, kobo, notes, pdf};

/// Lo llama la interfaz (ui/app.js) para abrir un libro.
#[tauri::command]
async fn open_book(path: String) -> Result<book::Book, String> {
    book::open(&path)
}

/// Un PDF a partir de los renglones de cada página que saca pdf.js (ver ui/pdf-reader.js).
#[tauri::command]
async fn pdf_book(pages: Vec<Vec<pdf::Line>>, outline: Vec<pdf::OutlineItem>, title: String, author: String) -> book::Book {
    pdf::build(pages, &outline, title, author)
}

/// Escribe los subrayados de un origen ("FastRead") en la nota del libro.
#[tauri::command]
async fn notes_section(dir: String, info: Info, source: String, clips: Vec<Clip>) -> Result<(), String> {
    notes::write_clips_section(&dir, &info, &source, &clips)
}

/// Escribe el resumen del libro en su nota (nada si está vacío).
#[tauri::command]
async fn notes_summary(dir: String, info: Info, text: String) -> Result<(), String> {
    notes::write_summary(&dir, &info, &text)
}

/// Actualiza propiedades de la nota del libro: `set` se reemplazan, `keep` solo si no existen.
#[tauri::command]
async fn notes_properties(dir: String, info: Info, set: Vec<(String, String)>, keep: Vec<(String, String)>) -> Result<(), String> {
    notes::write_properties(&dir, &info, &set, &keep)
}

/// Importa My Clippings.txt de un Kindle; busca los capítulos en `book_dirs`. Devuelve (subrayados, libros).
#[tauri::command]
async fn import_kindle(dir: String, file: String, book_dirs: Vec<String>) -> Result<(usize, usize), String> {
    kindle::import(&dir, &file, &book_dirs)
}

/// Importa la base de datos de un Kobo. Devuelve (subrayados, libros).
#[tauri::command]
async fn import_kobo(dir: String, file: String) -> Result<(usize, usize), String> {
    kobo::import(&dir, &file)
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
        .invoke_handler(tauri::generate_handler![
            open_book, pdf_book, book_cover, notes_section, notes_summary, notes_properties,
            import_kindle, import_kobo, read_bytes, write_bytes, read_text, write_text
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar FastRead");
}
