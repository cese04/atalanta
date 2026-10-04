// Pruebas de src/chapters.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use crate::book::tests::{temp_dir, write_epub, Index};

#[test]
fn simplificar_texto() {
    assert_eq!(simplify("¿Filosofía, Niño?"), "filosofianino");
    assert_eq!(simplify("un—libro"), "unlibro");
}

#[test]
fn capitulo_de_cada_cita() {
    let dir = temp_dir("capitulos");
    write_epub(&dir.join("Ana Autora"), "Libro de prueba - Ana Autora.epub", Index::Ncx); // en una subcarpeta, como en Calibre
    let quotes = [
        "Era una vez un—libro",          // capítulo 1
        "ra una vez un—libro & más.",    // empieza a mitad de palabra: se prueba desde la 2.ª
        "Texto dos. Sección 2.1",        // capítulo 2
        "Texto final y algo que no está en el libro",
        "Muy corta",                     // menos de 3 palabras: no se busca
    ]
    .map(String::from);
    let found = find("Libro de prueba", &quotes, &[dir.to_string_lossy().to_string()]);
    assert_eq!(found, ["Capítulo 1", "Capítulo 1", "Capítulo 2", "", ""]);
}

#[test]
fn sin_libro_no_hay_capitulos() {
    let quotes = ["Era una vez un libro".to_string()];
    assert_eq!(find("Otro título", &quotes, &[temp_dir("vacia").to_string_lossy().to_string()]), [""]);
}
