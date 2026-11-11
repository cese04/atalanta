// Pruebas de src/readers.rs. Se compilan como parte de ese archivo (ver `mod tests` al final).

use super::*;
use crate::book::tests::temp_dir;

#[test]
fn encuentra_el_kindle_y_el_kobo_entre_los_discos() {
    let root = temp_dir("lectores");
    let (usb, kindle, kobo) = (root.join("USB"), root.join("Kindle"), root.join("KOBOeReader"));
    std::fs::create_dir_all(usb.join("documents")).unwrap(); // un disco cualquiera, sin el archivo
    std::fs::create_dir_all(kindle.join("documents")).unwrap();
    std::fs::write(kindle.join(KINDLE_FILE), "").unwrap();
    std::fs::create_dir_all(kobo.join(".kobo")).unwrap();
    std::fs::write(kobo.join(KOBO_FILE), "").unwrap();

    let found = find_in(&[usb.clone(), kindle.clone(), kobo.clone()]);
    assert_eq!(found.kindle, kindle.join(KINDLE_FILE).to_string_lossy());
    assert_eq!(found.kobo, kobo.join(KOBO_FILE).to_string_lossy());
    assert_eq!(find_in(&[usb, root.join("no-existe")]), Readers::default());
}
