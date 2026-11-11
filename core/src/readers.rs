//! Busca un Kindle o un Kobo conectados por USB: el archivo con sus subrayados, en cada disco
//! conectado. Algunos Kindle recientes se conectan por MTP y no aparecen como disco: para esos,
//! la interfaz pide el archivo (ui/import.js).

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Dónde está cada archivo dentro del lector.
const KINDLE_FILE: &str = "documents/My Clippings.txt";
const KOBO_FILE: &str = ".kobo/KoboReader.sqlite";

/// Ruta del archivo de subrayados de cada lector conectado ("" si no hay).
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Readers {
    pub kindle: String,
    pub kobo: String,
}

pub fn find() -> Readers {
    find_in(&disks())
}

/// Busca los archivos en estos discos; si hay dos del mismo tipo, gana el primero.
pub fn find_in(disks: &[PathBuf]) -> Readers {
    let first = |file: &str| {
        disks.iter().map(|d| d.join(file)).find(|p| p.is_file()).map_or(String::new(), |p| p.to_string_lossy().into_owned())
    };
    Readers { kindle: first(KINDLE_FILE), kobo: first(KOBO_FILE) }
}

/// Discos conectados: en macOS, las carpetas de /Volumes; en Linux, las de /media/<usuario> y
/// /run/media/<usuario> (según la distribución), y /media por si se montan ahí; en Windows,
/// las unidades D: a Z:.
fn disks() -> Vec<PathBuf> {
    if cfg!(windows) {
        return ('D'..='Z').map(|c| PathBuf::from(format!("{c}:\\"))).collect();
    }
    let user = std::env::var("USER").unwrap_or_default();
    let parents = if cfg!(target_os = "macos") {
        vec!["/Volumes".to_string()]
    } else {
        vec![format!("/media/{user}"), format!("/run/media/{user}"), "/media".to_string()]
    };
    parents.iter().flat_map(|p| subfolders(Path::new(p))).collect()
}

fn subfolders(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect()
}

// Pruebas: core/tests/readers.rs
#[cfg(test)]
#[path = "../tests/readers.rs"]
mod tests;
