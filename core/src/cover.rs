//! Portada de un libro: la imagen tal como viene en el archivo (JPEG, PNG…). La interfaz la
//! reduce a miniatura (ver loadCover en ui/notes.js). Los PDF no pasan por aquí: su portada
//! es la primera página, que dibuja pdf.js.

use crate::book::{join, parent, parse_xml};
use std::fs::File;
use std::io::Read;

/// Bytes de la imagen de portada, o None si el libro no tiene.
pub fn cover(path: &str) -> Option<Vec<u8>> {
    let lower = path.to_lowercase();
    if lower.ends_with(".epub") {
        epub_cover(path)
    } else if lower.ends_with(".mobi") {
        mobi_cover(path)
    } else {
        None
    }
}

/// EPUB: la imagen declarada como portada en el .opf, de una de tres formas:
///   1. EPUB 3: <item properties="cover-image" …>
///   2. EPUB 2: <meta name="cover" content="id-de-la-imagen"/>
///   3. si no se declara: una imagen cuyo id o nombre de archivo contiene "cover"
fn epub_cover(path: &str) -> Option<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let container = text(&mut zip, "META-INF/container.xml")?;
    let opf_path = {
        let doc = parse_xml(&container).ok()?;
        doc.descendants().find(|n| n.has_tag_name("rootfile"))?.attribute("full-path")?.to_string()
    };
    let opf = text(&mut zip, &opf_path)?;
    let doc = parse_xml(&opf).ok()?;
    let images: Vec<_> = doc
        .descendants()
        .filter(|n| n.has_tag_name("item") && n.attribute("media-type").is_some_and(|t| t.starts_with("image/")))
        .collect();
    let declared_id = doc
        .descendants()
        .find(|n| n.has_tag_name("meta") && n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"));
    let item = images
        .iter()
        .find(|n| n.attribute("properties").is_some_and(|p| p.split_whitespace().any(|p| p == "cover-image")))
        .or_else(|| images.iter().find(|n| declared_id.is_some() && n.attribute("id") == declared_id))
        .or_else(|| {
            images.iter().find(|n| {
                let name = format!("{} {}", n.attribute("id").unwrap_or(""), n.attribute("href").unwrap_or(""));
                name.to_lowercase().contains("cover")
            })
        })?;
    let href = join(&parent(&opf_path), item.attribute("href")?);
    let mut entry = zip.by_name(&href).ok()?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// MOBI: el registro 201 de los metadatos (EXTH) dice cuál de las imágenes del libro es la portada.
fn mobi_cover(path: &str) -> Option<Vec<u8>> {
    let m = mobi::Mobi::from_path(path).ok()?;
    let record = m.metadata.exth.get_record(mobi::headers::ExthRecord::CoverOffset)?.first()?;
    let offset = u32::from_be_bytes(record.get(..4)?.try_into().ok()?) as usize;
    Some(m.image_records().get(offset)?.content.to_vec())
}

fn text(zip: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut s = String::new();
    zip.by_name(name).ok()?.read_to_string(&mut s).ok()?;
    Some(s)
}

// Pruebas: src-tauri/tests/cover.rs
#[cfg(test)]
#[path = "../tests/cover.rs"]
mod tests;
