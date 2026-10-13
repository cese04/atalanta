// Pruebas de src/cover.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use crate::book::tests::{temp_dir, write_epub, Index, RESOURCES};

#[test]
fn portada_de_epub_declarada_de_tres_formas() {
    let png = std::fs::read(format!("{RESOURCES}/libro-de-prueba/OEBPS/images/cover.png")).unwrap();
    // ncx.opf: <meta name="cover"> (EPUB 2) · nav.opf: properties="cover-image" (EPUB 3)
    // sin-indice.opf: sin declarar, pero el archivo se llama cover.png
    for (index, name) in [(Index::Ncx, "epub2"), (Index::Nav, "epub3"), (Index::None, "nombre")] {
        let epub = write_epub(&temp_dir(&format!("portada-{name}")), "libro.epub", index);
        assert_eq!(cover(&epub).as_deref(), Some(png.as_slice()), "{name}");
    }
}

#[test]
fn sin_portada_o_formato_sin_portada() {
    assert_eq!(cover("/no/existe.epub"), None);
    assert_eq!(cover("libro.pdf"), None); // la portada de un PDF la dibuja pdf.js
}
