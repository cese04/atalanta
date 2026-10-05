// Pruebas de src/kobo.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;

/// Crea la base de datos de prueba a partir de resources/kobo.sql (ahí se describe).
fn kobo_db() -> String {
    let dir = crate::book::tests::temp_dir("kobo");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("KoboReader.sqlite");
    Connection::open(&path).unwrap().execute_batch(include_str!("resources/kobo.sql")).unwrap();
    path.to_string_lossy().to_string()
}

#[test]
fn subrayados_con_capitulo_en_orden_de_lectura() {
    let clips = highlights(&kobo_db()).unwrap();
    let rows: Vec<_> = clips.iter().map(|c| (c.title.as_str(), c.chapter.as_str(), c.text.as_str(), c.note.as_str())).collect();
    assert_eq!(
        rows,
        [
            ("Sísifo", "Uno", "En el uno.", ""),
            ("Sísifo", "Uno", "", "Solo una nota"),          // nota sin texto: se conserva
            ("Sísifo", "Uno", "En el dos.", "Comentario"),   // b.html sigue en el capítulo "Uno"
            ("Sísifo", "Tres", "En el tres.", ""),
            ("Viejo", "Primero", "Del viejo.", ""),          // sin archivos de tipo 9: por ContentID
        ]
    );
    assert_eq!(clips[0].author, "Camus");
    assert_eq!(clips[0].description, "Un ensayo.\n\nSobre lo absurdo."); // el HTML se convierte a texto
    assert_eq!(clips[4].description, "");                                  // libro sin resumen
}

#[test]
fn archivo_inexistente_da_error() {
    assert!(highlights("/no/existe/KoboReader.sqlite").is_err());
}
