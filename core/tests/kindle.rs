// Pruebas de src/kindle.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use crate::book::tests::{temp_dir, write_epub, Index, RESOURCES};

fn clippings() -> String {
    // Recortes en español e inglés: un subrayado editado (dos versiones), su nota, un marcador,
    // otra frase en la misma posición y un título con "(Spanish Edition)".
    std::fs::read_to_string(format!("{RESOURCES}/My Clippings.txt")).unwrap()
}

#[test]
fn ediciones_notas_marcadores_y_titulos() {
    let clips: Vec<(String, String, String, String)> =
        parse(&clippings()).into_iter().map(|c| (c.title, c.author, c.text, c.note)).collect();
    let expected = [
        ("Demian", "Hermann Hesse", "El pájaro rompe el cascarón. El huevo es el mundo.", "La frase central."), // la última versión, con su nota
        ("Demian", "Hermann Hesse", "Otra frase en la misma posición.", ""),                                     // otra frase: no se pierde
        ("Tender Is the Night", "Fitzgerald, F. Scott", "The night was soft.", "Beautiful."),                   // sin "(Spanish Edition)"
    ];
    assert_eq!(clips, expected.map(|(a, b, c, d)| (a.to_string(), b.to_string(), c.to_string(), d.to_string())));
}

#[test]
fn posiciones_abreviadas() {
    assert_eq!(location("- Your Highlight | Location 1203-05 | Added"), (1203, 1205));
    assert_eq!(location("- Tu nota | posición 1.205 | Añadido"), (1205, 1205));
    assert_eq!(location("- Tu marcador en la página 3"), (0, 0));
}

#[test]
fn importar_con_capitulos_buscados_en_el_libro() {
    // Recortes de un libro que está en una carpeta de libros: la cita se busca en él para saber su capítulo.
    let books = temp_dir("kindle-libros");
    write_epub(&books, "Libro de prueba - Ana Autora.epub", Index::Ncx);
    let file = temp_dir("kindle-recortes").join("My Clippings.txt");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "Libro de prueba (Ana Autora)\n- Your Highlight on Location 10-12 | Added on Sunday\n\nTexto dos. Sección 2.1 Texto final.\n==========\n").unwrap();
    let notes = temp_dir("kindle-notas");
    let counts = import(notes.to_str().unwrap(), file.to_str().unwrap(), &[books.to_string_lossy().to_string()]).unwrap();
    assert_eq!(counts, (1, 1));
    let md = std::fs::read_to_string(notes.join("Libro de prueba.md")).unwrap();
    assert!(md.contains("## Resumen\n\nUn libro de prueba.")); // el resumen del libro encontrado
    assert!(md.contains("## Kindle\n\n### Capítulo 2\n\n> Texto dos. Sección 2.1 Texto final."));
}
