//! Subrayados de Kindle: el archivo `documents/My Clippings.txt` del lector. Cada entrada está
//! separada por "==========" y tiene esta forma (en inglés o español):
//!
//! ```text
//! Demian (Hermann Hesse)
//! - Tu subrayado en la página 12 | posición 170-171 | Añadido el lunes, 3 de octubre de 2026
//!
//! El pájaro rompe el cascarón.
//! ```

use crate::notes::{self, Clip};
use std::path::Path;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Highlight,
    Note,
    Bookmark,
}

struct Entry {
    clip: Clip,
    kind: Kind,
    start: u64, // posición en el Kindle
    end: u64,
}

/// Lee los subrayados de My Clippings.txt (ya unidos: ver `merge`).
pub fn parse(text: &str) -> Vec<Clip> {
    let mut entries = Vec::new();
    let mut block: Vec<&str> = Vec::new();
    for line in text.lines().chain(["=========="]) {
        if line.trim() != "==========" {
            block.push(line);
            continue;
        }
        let lines: Vec<&str> = block.iter().map(|l| l.trim_start_matches('\u{feff}').trim()).skip_while(|l| l.is_empty()).collect();
        block.clear();
        if lines.len() < 2 {
            continue;
        }
        let (head, meta) = (lines[0], lines[1]);
        let (title, author) = title_and_author(head);
        let (start, end) = location(meta);
        let words: Vec<String> = meta.to_lowercase().split(|c: char| !c.is_alphabetic()).map(String::from).collect();
        let kind = if words.iter().any(|w| w == "note" || w == "nota") {
            Kind::Note
        } else if words.iter().any(|w| w == "bookmark" || w == "marcador") {
            Kind::Bookmark
        } else {
            Kind::Highlight
        };
        let text = lines[2..].join("\n").trim().to_string();
        entries.push(Entry { clip: Clip { title, author, text, ..Default::default() }, kind, start, end });
    }
    merge(entries)
}

/// "Título (Spanish Edition) (Autor)" -> ("Título", "Autor"): el autor va en el último
/// paréntesis, y se quitan las menciones de edición para que coincida con la nota del libro.
fn title_and_author(head: &str) -> (String, String) {
    let (mut title, author) = match head.strip_suffix(')').and_then(|h| h.rfind('(').map(|i| (h, i))) {
        Some((h, i)) if !h[i + 1..].contains(')') => (h[..i].trim().to_string(), h[i + 1..].trim().to_string()),
        _ => (head.to_string(), String::new()),
    };
    // Quita "(Spanish Edition)", "(Edición conmemorativa)"…
    while let Some(range) = edition_group(&title) {
        title.replace_range(range, "");
    }
    (title.trim().to_string(), author)
}

/// Posición de un paréntesis que menciona la edición (termina en "edition" o empieza por
/// "edición"), incluido el espacio de antes.
fn edition_group(title: &str) -> Option<std::ops::Range<usize>> {
    let mut search = 0;
    while let Some(open) = title[search..].find('(').map(|i| search + i) {
        let close = open + title[open..].find(')')?;
        let inside = title[open + 1..close].to_lowercase();
        if !inside.contains('(') && (inside.ends_with("edition") || inside.starts_with("edición")) {
            let from = title[..open].trim_end().len();
            return Some(from..close + 1);
        }
        search = close + 1;
    }
    None
}

/// "posición 1203-1205" o "Location 1203-05" -> (1203, 1205); (0, 0) si no hay.
pub fn location(meta: &str) -> (u64, u64) {
    let lower = meta.to_lowercase();
    let at = ["location", "loc.", "posición", "posicion", "position"]
        .iter()
        .filter_map(|k| lower.find(k).map(|i| i + k.len()))
        .min();
    let Some(at) = at else { return (0, 0) };
    let rest = lower[at..].trim_start();
    let number_len = |s: &str| s.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ',')).unwrap_or(s.len());
    let to_number = |s: &str| s.chars().filter(char::is_ascii_digit).collect::<String>();
    let first = &rest[..number_len(rest)];
    let start_digits = to_number(first);
    let Ok(start) = start_digits.parse::<u64>() else { return (0, 0) };
    let after = rest[first.len()..].trim_start();
    let end = match after.strip_prefix('-') {
        Some(e) => {
            let e = e.trim_start();
            let end_digits = to_number(&e[..number_len(e)]);
            match end_digits.parse::<u64>() {
                // "1203-05": el final solo trae las últimas cifras
                Ok(end) if end < start && end_digits.len() < start_digits.len() => {
                    format!("{}{end_digits}", &start_digits[..start_digits.len() - end_digits.len()]).parse().unwrap_or(start)
                }
                Ok(end) => end,
                Err(_) => start,
            }
        }
        None => start,
    };
    (start, end)
}

/// Kindle guarda cada cambio como una entrada nueva. Por libro:
///  - si un subrayado se amplió o recortó (su texto contiene al anterior o al revés), queda el último;
///  - una nota se une al subrayado en cuya posición está; si no hay, queda como nota suelta;
///  - los marcadores se ignoran.
fn merge(entries: Vec<Entry>) -> Vec<Clip> {
    let mut merged: Vec<Entry> = Vec::new();
    for e in entries {
        if e.clip.text.is_empty() || e.kind == Kind::Bookmark {
            continue;
        }
        let same_book = |c: &&mut Entry| c.clip.title == e.clip.title && !c.clip.text.is_empty();
        match e.kind {
            Kind::Highlight => {
                let edited = merged.iter_mut().filter(same_book).find(|c| {
                    e.start <= c.end && e.end >= c.start && (e.clip.text.contains(&c.clip.text) || c.clip.text.contains(&e.clip.text))
                });
                match edited {
                    Some(c) => {
                        c.clip.text = e.clip.text;
                        c.start = e.start;
                        c.end = e.end;
                    }
                    None => merged.push(e),
                }
            }
            Kind::Note => {
                let target = merged.iter_mut().filter(same_book).find(|c| e.start >= c.start && e.start <= c.end);
                match target {
                    Some(c) => c.clip.note = e.clip.text,
                    None => merged.push(Entry {
                        clip: Clip { note: e.clip.text, text: String::new(), ..e.clip },
                        end: e.start,
                        ..e
                    }),
                }
            }
            Kind::Bookmark => {}
        }
    }
    merged.sort_by(|a, b| a.clip.title.to_lowercase().cmp(&b.clip.title.to_lowercase()).then(a.start.cmp(&b.start)));
    merged.into_iter().map(|e| e.clip).collect()
}

/// Importa My Clippings.txt a la carpeta de notas: busca el capítulo de cada cita (y el
/// resumen) en los libros de `book_dirs` (ver chapters.rs) y escribe la sección "## Kindle"
/// de cada libro. Devuelve (subrayados, libros).
pub fn import(notes_dir: &str, file: &str, book_dirs: &[String]) -> Result<(usize, usize), String> {
    let text = std::fs::read_to_string(Path::new(file)).map_err(|e| e.to_string())?;
    let mut clips = parse(&text);
    let mut titles: Vec<String> = clips.iter().map(|c| c.title.clone()).collect();
    titles.dedup();
    for title in titles {
        let quoted: Vec<String> = clips.iter().filter(|c| c.title == title && !c.text.is_empty()).map(|c| c.text.clone()).collect();
        let found = crate::chapters::find(&title, &quoted, book_dirs);
        let mut chapters = found.chapters.into_iter();
        for c in clips.iter_mut().filter(|c| c.title == title) {
            if !c.text.is_empty() {
                c.chapter = chapters.next().unwrap_or_default();
            }
            c.description = found.description.clone();
        }
    }
    notes::write_clips(notes_dir, "Kindle", &clips)
}

// Pruebas: core/tests/kindle.rs
#[cfg(test)]
#[path = "../tests/kindle.rs"]
mod tests;
