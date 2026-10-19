//! Reconstrucción de un libro a partir de un PDF. La interfaz saca los renglones de cada
//! página con pdf.js (ver ui/pdf-reader.js) y aquí se convierten en la misma estructura que los
//! EPUB y MOBI (ver book.rs). Un PDF solo dice qué texto va en qué posición, así que hay que:
//!   1. quitar encabezados, pies y números de página (`strip_running_lines`) y las notas al pie
//!      (`strip_footnotes`), que interrumpirían la lectura palabra por palabra;
//!   2. unir renglones en párrafos (cortando por espacio, sangría o renglón corto), unir palabras
//!      partidas con guion y detectar títulos por su tamaño de letra;
//!   3. tomar el índice de los marcadores del PDF o, si no tiene, de los títulos detectados.

use crate::book::{Book, Chapter};
use serde::Deserialize;
use std::collections::HashMap;

/// Un renglón de una página: `y` crece hacia arriba (coordenadas de PDF); `size` es el tamaño
/// de letra y `right` dónde acaba el renglón.
#[derive(Deserialize, Clone, Debug)]
pub struct Line {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub right: f64,
}

/// Un marcador del PDF (página empezando en 0).
#[derive(Deserialize, Clone, Debug)]
pub struct OutlineItem {
    pub title: String,
    pub level: usize,
    pub page: usize,
}

/// Valor en la posición `q` (0 a 1) de una lista ordenada: 0.5 es la mediana.
fn quantile(values: impl Iterator<Item = f64>, q: f64) -> f64 {
    let mut sorted: Vec<f64> = values.collect();
    sorted.sort_by(|a, b| a.total_cmp(b));
    if sorted.is_empty() { 0.0 } else { sorted[((sorted.len() - 1) as f64 * q) as usize] }
}

fn median(values: impl Iterator<Item = f64>) -> f64 {
    quantile(values, 0.5)
}

/// Índices de los dos primeros y dos últimos renglones de una página.
fn edges(count: usize) -> Vec<usize> {
    let mut e: Vec<usize> = (0..count.min(2)).chain(count.saturating_sub(2)..count).collect();
    e.dedup();
    e
}

/// Quita encabezados, pies y números de página: de los dos primeros y dos últimos renglones de
/// cada página, los que son solo un número o se repiten (sin contar los números) en 3 páginas o
/// más. Basta con 3 porque el encabezado suele cambiar con cada capítulo ("224 Capítulo 7").
fn strip_running_lines(pages: Vec<Vec<Line>>) -> Vec<Vec<Line>> {
    let key = |text: &str| {
        let mut k = String::new();
        for c in text.to_lowercase().chars() {
            if c.is_ascii_digit() {
                if !k.ends_with('#') { k.push('#') }
            } else {
                k.push(c);
            }
        }
        k
    };
    let mut counts: HashMap<String, usize> = HashMap::new();
    for lines in &pages {
        let mut keys: Vec<String> = edges(lines.len()).iter().map(|&i| key(&lines[i].text)).collect();
        keys.sort();
        keys.dedup();
        for k in keys {
            *counts.entry(k).or_default() += 1;
        }
    }
    let page_number = |t: &str| {
        !t.is_empty() && (t.chars().all(|c| c.is_ascii_digit()) || (t.len() <= 6 && t.to_lowercase().chars().all(|c| "ivxlcdm".contains(c))))
    };
    pages
        .into_iter()
        .map(|lines| {
            let edge = edges(lines.len());
            lines
                .into_iter()
                .enumerate()
                .filter(|(i, l)| !edge.contains(i) || (!page_number(&l.text) && counts.get(&key(&l.text)).copied().unwrap_or(0) < 3))
                .map(|(_, l)| l)
                .collect()
        })
        .collect()
}

/// Quita las notas al pie: los renglones de letra más pequeña que el texto que quedan al final
/// de la página, después de su último renglón de tamaño normal.
fn strip_footnotes(pages: Vec<Vec<Line>>, body: f64) -> Vec<Vec<Line>> {
    pages
        .into_iter()
        .map(|mut lines| {
            while lines.last().is_some_and(|l| l.size < body * 0.92) {
                lines.pop();
            }
            lines
        })
        .collect()
}

/// Renglones de todas las páginas -> libro.
pub fn build(pages: Vec<Vec<Line>>, outline: &[OutlineItem], title: String, author: String) -> Book {
    let pages = strip_running_lines(pages);
    let body = Some(median(pages.iter().flatten().map(|l| l.size))).filter(|b| *b > 0.0).unwrap_or(1.0); // tamaño del texto
    let pages = strip_footnotes(pages, body);
    let all = || pages.iter().flatten();
    let left = median(all().map(|l| l.x.round()));       // margen izquierdo habitual
    let right = quantile(all().map(|l| l.right), 0.8);  // donde acaba un renglón completo (los cortos no cuentan)
    let gaps = pages.iter().flat_map(|lines| lines.windows(2).map(|w| w[0].y - w[1].y).filter(|g| *g > 0.0));
    let gap = Some(median(gaps)).filter(|g| *g > 0.0).unwrap_or(body * 1.2); // espacio habitual entre renglones

    let kind_of = |l: &Line| match l.size {
        s if s >= body * 1.6 => "h1",
        s if s >= body * 1.3 => "h2",
        _ => "",
    };
    let closes_sentence = |t: &str| t.ends_with(['.', '!', '?', ':', '…', '"', '»', '”', ')']);
    let mut paragraphs: Vec<(&'static str, String)> = Vec::new(); // (tipo, texto)
    let mut page_start: Vec<Option<(usize, usize)>> = vec![None; pages.len()]; // (párrafo, palabras antes) del primer renglón
    let mut prev: Option<&Line> = None;
    for (p, lines) in pages.iter().enumerate() {
        for (i, line) in lines.iter().enumerate() {
            let kind = if line.text.chars().count() < 120 { kind_of(line) } else { "" };
            let new_paragraph = match paragraphs.last() {
                None => true,
                Some((current_kind, _)) => {
                    kind != *current_kind                                               // empieza o termina un título
                        || (i > 0 && lines[i - 1].y - line.y > gap * 1.6)              // espacio vertical extra
                        || (kind.is_empty() && line.x > left + body)                    // sangría de primera línea
                        || prev.is_some_and(|pl| pl.right < right - body * 3.0 && closes_sentence(&pl.text)) // renglón corto que cierra frase
                }
            };
            if new_paragraph {
                paragraphs.push((kind, line.text.clone()));
            } else {
                let current = &mut paragraphs.last_mut().unwrap().1;
                let hyphenated = current.strip_suffix('-').and_then(|t| t.chars().last()).is_some_and(char::is_alphabetic)
                    && line.text.chars().next().is_some_and(char::is_lowercase);
                if hyphenated {
                    current.pop(); // "pala-" + "bra"
                    current.push_str(&line.text);
                } else {
                    current.push(' ');
                    current.push_str(&line.text);
                }
            }
            if page_start[p].is_none() {
                let words_now = paragraphs.last().unwrap().1.split_whitespace().count();
                let before = if new_paragraph { 0 } else { words_now.saturating_sub(line.text.split_whitespace().count()) };
                page_start[p] = Some((paragraphs.len() - 1, before));
            }
            prev = Some(line);
        }
    }

    // Palabras y párrafos con la misma forma que los libros de Rust.
    let mut words = Vec::new();
    let mut starts = Vec::new();
    for (_, text) in &paragraphs {
        starts.push(words.len());
        words.extend(text.split_whitespace().map(String::from));
    }
    // Primera palabra de cada página (las páginas sin texto toman la de la siguiente).
    let last = words.len().saturating_sub(1);
    let mut page_word = vec![0; pages.len()];
    let mut next = words.len();
    for p in (0..pages.len()).rev() {
        if let Some((paragraph, before)) = page_start[p] {
            next = starts[paragraph] + before;
        }
        page_word[p] = next.min(last);
    }

    let mut toc: Vec<Chapter> = outline
        .iter()
        .filter(|o| !o.title.is_empty() && o.page < pages.len())
        .map(|o| Chapter { title: o.title.clone(), level: o.level, word: page_word[o.page] })
        .collect();
    if toc.is_empty() {
        toc = paragraphs
            .iter()
            .zip(&starts)
            .filter(|((kind, _), _)| !kind.is_empty())
            .map(|((kind, text), &word)| Chapter { title: text.clone(), level: if *kind == "h1" { 0 } else { 1 }, word })
            .collect();
    }
    let kinds = paragraphs.iter().map(|(kind, _)| *kind).collect();
    Book::new(title, author, String::new(), words, starts, kinds, vec![], vec![], toc)
}

// Pruebas: core/tests/pdf.rs
#[cfg(test)]
#[path = "../tests/pdf.rs"]
mod tests;
