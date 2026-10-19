// Pruebas de src/pdf.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use crate::book::tests::RESOURCES;
use serde::Deserialize;

/// Renglones de un PDF de 3 páginas (ver su "descripcion" en el archivo).
#[derive(Deserialize)]
struct Sample {
    paginas: Vec<Vec<Line>>,
    marcadores: Vec<OutlineItem>,
}

fn sample() -> Sample {
    serde_json::from_str(&std::fs::read_to_string(format!("{RESOURCES}/pdf-paginas.json")).unwrap()).unwrap()
}

/// Texto de cada párrafo del libro, con su tipo.
fn paragraphs(book: &Book) -> Vec<(&str, String)> {
    (0..book.paragraphs.len())
        .map(|i| {
            let end = book.paragraphs.get(i + 1).copied().unwrap_or(book.words.len());
            (book.kinds[i], book.words[book.paragraphs[i]..end].join(" "))
        })
        .collect()
}

#[test]
fn parrafos_titulos_palabras_partidas_sin_encabezados_numeros_ni_notas() {
    let s = sample();
    let book = build(s.paginas, &s.marcadores, "Mi libro".into(), "Ana".into());
    let expected = [
        ("h1", "Capítulo uno"),
        ("", "Era una vez un libro muy largo que seguía."),                       // "li-" + "bro"; sangría
        ("", "Otro párrafo que continúa en la página siguiente y aquí termina."), // sigue en la página 2
        ("", "Un párrafo tras un espacio y largo que ocupa dos renglones completos"),
        ("h1", "Capítulo dos"),
        ("", "Fin del libro."),
    ]; // sin "Mi libro" (encabezado), sin "1", "2", "3" (números de página) ni la nota al pie
    assert_eq!(paragraphs(&book), expected.map(|(k, t)| (k, t.to_string())));
    assert_eq!(book.author, "Ana");
}

#[test]
fn indice_desde_los_marcadores_en_la_primera_palabra_de_su_pagina() {
    let s = sample();
    let book = build(s.paginas, &s.marcadores, String::new(), String::new());
    let dos = book.words.iter().skip(1).position(|w| w == "Capítulo").unwrap() + 1;
    let toc: Vec<(&str, usize, usize)> = book.toc.iter().map(|c| (c.title.as_str(), c.level, c.word)).collect();
    assert_eq!(toc, [("Uno", 0, 0), ("Dos", 0, dos)]);
}

#[test]
fn sin_marcadores_el_indice_sale_de_los_titulos() {
    let s = sample();
    let book = build(s.paginas, &[], String::new(), String::new());
    let titles: Vec<&str> = book.toc.iter().map(|c| c.title.as_str()).collect();
    assert_eq!(titles, ["Capítulo uno", "Capítulo dos"]);
}
