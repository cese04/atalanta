//! Busca en qué capítulo de un libro está cada cita. Sirve para los subrayados de
//! Kindle, que no guardan el capítulo: se busca el texto de la cita dentro del libro.

use crate::book::{self, Book};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct Found {
    pub chapters: Vec<String>, // capítulo de cada cita, en el mismo orden ("" si no se encontró)
    pub description: String,   // resumen del libro encontrado ("" si no hay)
}

/// Busca el libro por su nombre de archivo, parecido a `title`, dentro de `dirs` y sus
/// subcarpetas, y devuelve el capítulo de cada cita y el resumen del libro.
pub fn find(title: &str, quotes: &[String], dirs: &[String]) -> Found {
    let key: String = simplify(title).chars().take(20).collect();
    let mut files = Vec::new();
    for dir in dirs {
        collect_books(Path::new(dir), 3, &mut files);
    }

    // Puede haber varios archivos parecidos: gana el que contiene más citas.
    let mut best = Found { chapters: vec![String::new(); quotes.len()], description: String::new() };
    let mut most_found = 0;
    for file in files {
        let name = simplify(&file.file_name().unwrap_or_default().to_string_lossy());
        if key.is_empty() || !name.contains(&key) {
            continue;
        }
        let Ok(book) = book::open(&file.to_string_lossy()) else { continue };
        let chapters = chapters_in(&book, quotes);
        let found = chapters.iter().filter(|c| c.is_some()).count();
        if found > most_found {
            most_found = found;
            best.chapters = chapters.into_iter().map(Option::unwrap_or_default).collect();
            best.description = book.description;
        }
    }
    best
}

/// Para cada cita: Some(capítulo) si se encontró en el libro ("" si cae antes del primer capítulo).
fn chapters_in(book: &Book, quotes: &[String]) -> Vec<Option<String>> {
    // Palabras del libro simplificadas, sin las que son solo signos (y su posición original).
    let (words, positions): (Vec<String>, Vec<usize>) = book
        .words
        .iter()
        .enumerate()
        .map(|(i, w)| (simplify(w), i))
        .filter(|(w, _)| !w.is_empty())
        .unzip();

    quotes
        .iter()
        .map(|quote| {
            let at = positions[locate(&words, quote)?];
            let chapter = book.toc.iter().filter(|c| c.word <= at).max_by_key(|c| c.word);
            Some(chapter.map(|c| c.title.clone()).unwrap_or_default())
        })
        .collect()
}

/// Dónde está la cita: busca 6 de sus palabras seguidas. Si la cita empieza a mitad de
/// palabra o con un número de nota, prueba desde su segunda y tercera palabra.
fn locate(words: &[String], quote: &str) -> Option<usize> {
    let wanted: Vec<String> = quote.split_whitespace().map(simplify).filter(|w| !w.is_empty()).collect();
    for skip in 0..3 {
        let window = wanted.get(skip..wanted.len().min(skip + 6))?;
        if window.len() < 3 {
            return None; // muy corta para no confundirla con otro lugar
        }
        if let Some(i) = words.windows(window.len()).position(|w| w == window) {
            return Some(i);
        }
    }
    None
}

/// Libros (.epub y .mobi) dentro de una carpeta, bajando hasta `depth` niveles.
fn collect_books(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for path in entries.flatten().map(|e| e.path()) {
        if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
            continue;
        }
        if path.is_dir() {
            if depth > 0 {
                collect_books(&path, depth - 1, out);
            }
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("epub") || e.eq_ignore_ascii_case("mobi")) {
            out.push(path);
        }
    }
}

/// "¿Filosofía?" -> "filosofia": minúsculas, sin acentos ni signos (para comparar textos).
fn simplify(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .filter_map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => Some('a'),
            'é' | 'è' | 'ë' | 'ê' => Some('e'),
            'í' | 'ì' | 'ï' | 'î' => Some('i'),
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => Some('o'),
            'ú' | 'ù' | 'ü' | 'û' => Some('u'),
            'ñ' => Some('n'),
            'ç' => Some('c'),
            c if c.is_alphanumeric() => Some(c),
            _ => None,
        })
        .collect()
}

// Pruebas: src-tauri/tests/chapters.rs
#[cfg(test)]
#[path = "../tests/chapters.rs"]
mod tests;
