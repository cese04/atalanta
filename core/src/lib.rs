//! Lógica de Atalanta, sin interfaz: leer libros (EPUB, MOBI y la reconstrucción de PDF),
//! portadas, subrayados de Kobo y Kindle, capítulos de las citas, ritmo de lectura y notas
//! de Obsidian. La app (src-tauri) solo la conecta con la interfaz.

pub mod book;
pub mod chapters;
pub mod cover;
pub mod kindle;
pub mod kobo;
pub mod notes;
pub mod pdf;
pub mod rhythm;
