// Pruebas de src/book.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use std::io::Write;
use std::path::Path;

/// Qué índice lleva el EPUB de prueba.
#[derive(Clone, Copy)]
pub enum Index {
    Ncx,  // EPUB 2: toc.ncx
    Nav,  // EPUB 3: nav.xhtml
    None, // sin índice: se usan los títulos <h1>-<h3>
}

/// Carpeta con los archivos de prueba (tests/resources).
pub const RESOURCES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/resources");

/// Crea en `dir` un EPUB con el contenido de resources/libro-de-prueba y el content.opf
/// de resources/opf que corresponde a `index`. Devuelve su ruta. Su texto, palabra por palabra:
///   0 Capítulo 1 | 2 Era una vez un—libro & más. | 8 Segundo párrafo.
///  10 Capítulo 2 | 12 Texto dos. | 14 Sección 2.1 | 16 Texto final.
pub fn write_epub(dir: &Path, name: &str, index: Index) -> String {
    let source = Path::new(RESOURCES).join("libro-de-prueba");
    let opf = match index {
        Index::Ncx => "ncx.opf",
        Index::Nav => "nav.opf",
        Index::None => "sin-indice.opf",
    };
    let mut files = vec![("mimetype".to_string(), source.join("mimetype"))]; // va primero en un EPUB
    for path in ["META-INF/container.xml", "OEBPS/toc.ncx", "OEBPS/nav.xhtml", "OEBPS/text/cap1.xhtml", "OEBPS/text/cap2.xhtml", "OEBPS/images/cover.png"] {
        files.push((path.to_string(), source.join(path)));
    }
    files.push(("OEBPS/content.opf".to_string(), Path::new(RESOURCES).join("opf").join(opf)));

    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, file) in files {
        zip.start_file(name, options).unwrap();
        zip.write_all(&std::fs::read(file).unwrap()).unwrap();
    }
    zip.finish().unwrap();
    path.to_string_lossy().to_string()
}

pub fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("fastread-pruebas-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn toc(book: &Book) -> Vec<(&str, usize, usize)> {
    book.toc.iter().map(|c| (c.title.as_str(), c.level, c.word)).collect()
}

#[test]
fn epub_palabras_parrafos_titulo_y_autor() {
    let book = open(&write_epub(&temp_dir("epub"), "libro.epub", Index::Ncx)).unwrap();
    assert_eq!(book.title, "Libro de prueba");
    assert_eq!(book.author, "Ana Autora");
    // El resumen viene como HTML escapado en <dc:description>: se convierte a texto con párrafos.
    assert_eq!(book.description, "Un libro de prueba.\n\nSegundo párrafo & fin.");
    // <head>, <style> y los comentarios no se leen; "E" + "ra" se unen (letra capital);
    // &nbsp; separa; &mdash; y &amp; se decodifican. (ver resources/libro-de-prueba/OEBPS/text/cap1.xhtml)
    assert_eq!(
        book.words,
        ["Capítulo", "1", "Era", "una", "vez", "un—libro", "&", "más.", "Segundo", "párrafo.",
         "Capítulo", "2", "Texto", "dos.", "Sección", "2.1", "Texto", "final."]
    );
    assert_eq!(book.paragraphs, [0, 2, 8, 10, 12, 14, 16]);
    assert_eq!(book.kinds, ["h1", "", "", "h1", "", "h2", ""]); // <h1>Capítulo…</h1>, <h2>Sección 2.1</h2>
    assert!(book.scene_breaks.is_empty());
}

#[test]
fn epub2_indice_ncx_con_subcapitulos() {
    let book = open(&write_epub(&temp_dir("ncx"), "libro.epub", Index::Ncx)).unwrap();
    assert_eq!(toc(&book), [("Capítulo 1", 0, 0), ("Capítulo 2", 0, 10), ("Sección 2.1", 1, 14)]);
}

#[test]
fn epub3_indice_nav() {
    let book = open(&write_epub(&temp_dir("nav"), "libro.epub", Index::Nav)).unwrap();
    assert_eq!(toc(&book), [("Uno", 0, 0), ("Dos", 0, 10), ("Dos punto uno", 1, 14)]);
}

#[test]
fn sin_indice_usa_los_titulos() {
    let book = open(&write_epub(&temp_dir("sin-indice"), "libro.epub", Index::None)).unwrap();
    assert_eq!(toc(&book), [("Capítulo 1", 0, 0), ("Capítulo 2", 0, 10), ("Sección 2.1", 1, 14)]);
}

#[test]
fn formatos_no_soportados_o_inexistentes() {
    assert!(open("libro.pdf").is_err());
    assert!(open("/no/existe.epub").is_err());
}

#[test]
fn indice_de_mobi_ignora_enlaces_sin_letras() {
    let html = r#"<a filepos=0000123>Capítulo <b>1</b></a> <a filepos="456">&lt;&lt;</a> <a filepos=789>[12]</a>"#;
    assert_eq!(mobi_links(html), [("Capítulo 1".to_string(), 123)]);
}

#[test]
fn entidades_html() {
    assert_eq!(decode_entities("a&amp;b &lt;&#233;&#xE9;&mdash;&desconocida; & suelto"), "a&b <éé—&desconocida; & suelto");
}

#[test]
fn formato_de_parrafos() {
    let mut text = Text::default();
    text.add_html("", include_str!("resources/formato.xhtml"));
    let paragraphs: Vec<(&str, &str)> = text
        .paragraphs
        .iter()
        .zip(&text.kinds)
        .map(|(&start, &kind)| (text.words[start].as_str(), kind))
        .collect();
    assert_eq!(
        paragraphs,
        [
            ("Título", "h1"),
            ("Texto", ""),
            ("Cita", "quote"),
            ("Cita", "quote"), // los dos párrafos de la cita
            ("Después", ""),   // la cita ya terminó
            ("Nueva", ""),
            ("Subtítulo", "h2"),
            ("Menor", "h3"),   // <h5> cuenta como h3
            ("Fin.", ""),
        ]
    );
    assert_eq!(text.scene_breaks, [5]); // "Nueva escena." va después de un <hr/>
}

#[test]
fn blockquote_como_sangria_no_es_cita() {
    // 2 de 3 párrafos dentro de <blockquote>: es maquetación (sangría), no son citas.
    let mut text = Text::default();
    text.add_html("libro", "<blockquote><p>Uno.</p><p>Dos.</p></blockquote><p>Tres.</p>");
    assert_eq!(text.into_book(String::new(), String::new(), vec![]).kinds, ["", "", ""]);
}

#[test]
fn estilos_dentro_del_texto() {
    let mut text = Text::default();
    text.add_html("", include_str!("resources/estilos.xhtml"));
    let styled: Vec<(&str, u8)> = text.words.iter().map(String::as_str).zip(text.word_styles.iter().copied()).collect();
    let (i, b, big, small) = (STYLE_ITALIC, STYLE_BOLD, STYLE_LARGER, STYLE_SMALLER);
    assert_eq!(
        styled,
        [
            ("normal", 0), ("cursiva", i), ("negrita", b), ("ambas", b | i), ("normal", 0),
            ("span-cursiva", i), ("span-negrita", b),
            ("grande", big), ("chica", small), ("normal", 0), ("big", big), ("small", small),
            ("Capital", 0), // "Ca<b>pi</b>tal" es una sola palabra: queda con el estilo de su comienzo
            ("fin", 0),
        ]
    );
}

#[test]
fn estilo_de_casi_todo_el_libro_se_ignora() {
    // Una <b> sin cerrar vuelve negrita casi todo el texto: se ignora. La cursiva (1 de 4) se queda.
    let mut text = Text::default();
    text.add_html("libro", "<p><i>Uno</i> <b>dos</p><p>tres cuatro</p>");
    let book = text.into_book(String::new(), String::new(), vec![]);
    assert_eq!(book.styles, [(0, 1, STYLE_ITALIC)]);
}

#[test]
fn estilos_agrupados_en_tramos() {
    assert_eq!(style_runs(&[0, 1, 1, 0, 2, 3, 3]), [(1, 3, 1), (4, 5, 2), (5, 7, 3)]);
    assert!(style_runs(&[0, 0]).is_empty());
}

#[test]
fn html_a_texto_plano() {
    assert_eq!(plain_text("<div><p>Uno <b>dos</b>.</p><p>Tres&nbsp;cuatro.</p></div>"), "Uno dos.\n\nTres cuatro.");
    assert_eq!(plain_text("Sin etiquetas."), "Sin etiquetas.");
    // <cite>, <q>… no cortan el párrafo (como en el resumen de Demian)
    assert_eq!(plain_text("<p><cite>Demian</cite> es la <q>historia</q>.</p>"), "Demian es la historia.");
    assert_eq!(plain_text(""), "");
}

#[test]
fn rutas_y_atributos() {
    assert_eq!(join("OEBPS/text", "../img/a.png"), "OEBPS/img/a.png");
    assert_eq!(join("", "mi%20libro.html"), "mi libro.html");
    assert_eq!(parent("OEBPS/content.opf"), "OEBPS");
    assert_eq!(attr(r#"p id="x" class='y'"#, "class"), Some("y"));
    assert_eq!(attr(r#"p data-id="x""#, "id"), None);
    assert_eq!(attr("font size=4", "size"), Some("4")); // sin comillas, como en algunos MOBI
    assert_eq!(attr("br size=4/", "size"), Some("4"));
}
