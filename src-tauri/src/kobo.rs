//! Subrayados guardados en un Kobo: el lector los anota en su base de datos
//! `.kobo/KoboReader.sqlite` (tabla `Bookmark`; los libros y capítulos están en `content`).

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

#[derive(Serialize)]
pub struct Clip {
    pub title: String,
    pub author: String,
    pub chapter: String,
    pub text: String, // texto subrayado (puede estar vacío si es solo una nota)
    pub note: String, // comentario
}

// Un subrayado apunta a su libro (VolumeID) y al archivo interno del libro donde está
// (ContentID). En `content`, cada libro tiene:
//   - filas de tipo 9: sus archivos internos, con su orden de lectura (VolumeIndex);
//   - filas de tipo 899: sus capítulos, con ContentID "<archivo>-N" del archivo donde empiezan.
// Un capítulo puede abarcar varios archivos, así que el capítulo de un subrayado es el
// último que empieza en su archivo o en uno anterior. Si el libro no tiene esa
// información (algunos EPUB no convertidos a kepub), se usa el capítulo cuyo ContentID
// empieza igual que el del subrayado.
const QUERY: &str = "
    SELECT IFNULL(book.Title, ''),
           IFNULL(book.Attribution, ''),
           COALESCE(
               (SELECT ch.Title
                FROM content ch
                JOIN content chfile ON chfile.ContentType = 9 AND chfile.BookID = ch.BookID
                     AND substr(ch.ContentID, 1, length(chfile.ContentID) + 1) = chfile.ContentID || '-'
                WHERE ch.ContentType = 899 AND ch.BookID = b.VolumeID
                      AND chfile.VolumeIndex <= file.VolumeIndex
                ORDER BY chfile.VolumeIndex DESC, ch.VolumeIndex DESC
                LIMIT 1),
               (SELECT c.Title FROM content c
                WHERE c.ContentType = 899 AND c.ContentID LIKE b.ContentID || '%' LIMIT 1),
               ''),
           TRIM(IFNULL(b.Text, '')),
           TRIM(IFNULL(b.Annotation, ''))
    FROM Bookmark b
    JOIN content book ON book.ContentID = b.VolumeID
    LEFT JOIN content file ON file.ContentType = 9 AND file.ContentID = b.ContentID
    WHERE TRIM(IFNULL(b.Text, '')) <> '' OR TRIM(IFNULL(b.Annotation, '')) <> ''
    ORDER BY book.Title, IFNULL(file.VolumeIndex, 0), b.ChapterProgress";

pub fn highlights(path: &str) -> Result<Vec<Clip>, String> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let mut query = db.prepare(QUERY).map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            Ok(Clip { title: row.get(0)?, author: row.get(1)?, chapter: row.get(2)?, text: row.get(3)?, note: row.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// Pruebas: src-tauri/tests/kobo.rs
#[cfg(test)]
#[path = "../tests/kobo.rs"]
mod tests;
