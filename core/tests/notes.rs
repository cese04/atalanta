// Pruebas de src/notes.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;
use crate::book::tests::{temp_dir, RESOURCES};

fn clip(title: &str, chapter: &str, text: &str, note: &str) -> Clip {
    Clip { title: title.into(), author: "Hermann Hesse".into(), chapter: chapter.into(), text: text.into(), note: note.into(), ..Default::default() }
}

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

#[test]
fn nombres_de_archivo_sin_caracteres_problematicos() {
    assert_eq!(file_name("Rayuela: \"edición\" [RAE]"), "Rayuela edición RAE");
    assert_eq!(file_name("  Uno   dos  "), "Uno dos");
    assert_eq!(file_name("###"), "Libro");
}

#[test]
fn subrayados_como_markdown_por_capitulo() {
    let clips = [clip("Demian", "Capítulo 5", "El pájaro.\n\nEl huevo.", "Central."), clip("Demian", "Capítulo 5", "Otra.", ""), clip("Demian", "", "", "Nota suelta")];
    assert_eq!(
        clips_markdown("Kindle", &clips),
        "## Kindle\n\n### Capítulo 5\n\n> El pájaro.\n>\n> El huevo.\n\nCentral.\n\n> Otra.\n\nNota suelta"
    );
}

#[test]
fn secciones_por_origen_sin_duplicar_y_conservando_lo_escrito_a_mano() {
    let dir = temp_dir("notas-secciones");
    let dir = dir.to_str().unwrap();
    std::fs::create_dir_all(dir).unwrap();
    let note = note_path(dir, "Demian");
    std::fs::copy(format!("{RESOURCES}/Demian.md"), &note).unwrap(); // texto propio y una sección de FastRead vieja
    let info = Info { title: "Demian".into(), ..Default::default() };
    let kindle = [clip("Demian", "Capítulo 5", "El pájaro.\n\nEl huevo.", "Central.")];
    write_clips_section(dir, &info, "Kindle", &kindle).unwrap();
    write_clips_section(dir, &info, "Kindle", &kindle).unwrap(); // reimportar
    write_clips_section(dir, &info, "FastRead", &[clip("Demian", "", "Cita nueva", "")]).unwrap();

    let md = std::fs::read_to_string(&note).unwrap();
    assert_eq!(md.matches("## Kindle").count(), 1, "una sola sección de Kindle");
    assert_eq!(md.matches("## FastRead").count(), 1, "una sola sección de FastRead");
    assert!(md.contains("Cita nueva") && !md.contains("Cita vieja"));
    assert!(md.contains("Mis ideas ANTES") && md.contains("Mis ideas DESPUÉS"));
    assert!(md.contains("### Capítulo 5\n\n> El pájaro.\n>\n> El huevo.\n\nCentral."));
}

#[test]
fn una_nota_nueva_empieza_con_sus_propiedades() {
    let dir = temp_dir("notas-nueva");
    let dir = dir.to_str().unwrap();
    let info = Info { title: "Rayuela: \"edición\" [RAE]".into(), author: "Julio Cortázar".into(), source: "Kobo".into() };
    write_section(dir, &info, "Kobo", "## Kobo", false).unwrap();
    let md = std::fs::read_to_string(note_path(dir, &info.title)).unwrap();
    assert!(md.starts_with("---\ntitle: \"Rayuela: \\\"edición\\\" [RAE]\"\nauthor: \"Julio Cortázar\"\nsource: \"Kobo\"\ntags: [libro]\n---\n"));
    assert!(note_path(dir, &info.title).ends_with("Rayuela edición RAE.md"));
}

#[test]
fn propiedades_se_reemplazan_o_anaden_sin_tocar_las_demas() {
    let md = "---\ntitle: \"Demian\"\nrating: 5\nprogress: 10\nstarted: 2026-01-02\n---\n\nMis ideas\n";
    let result = update_properties(md, &pairs(&[("progress", "40"), ("wpm", "350")]), &pairs(&[("started", "2026-10-12"), ("finished", "2026-10-12")]));
    // "rating" (tuya) se conserva; "started" ya existía y no cambia
    assert_eq!(result, "---\ntitle: \"Demian\"\nrating: 5\nprogress: 40\nstarted: 2026-01-02\nwpm: 350\nfinished: 2026-10-12\n---\n\nMis ideas\n");
}

#[test]
fn una_nota_sin_propiedades_recibe_el_bloque_arriba() {
    assert_eq!(update_properties("Mis ideas\n", &pairs(&[("progress", "5")]), &[]), "---\nprogress: 5\n---\n\nMis ideas\n");
}

#[test]
fn propiedades_de_lectura_crean_la_nota_y_solo_escriben_si_cambian() {
    let dir = temp_dir("notas-propiedades");
    let dir = dir.to_str().unwrap();
    let info = Info { title: "Demian".into(), author: "Hermann Hesse".into(), source: "Demian.epub".into() };
    write_properties(dir, &info, &pairs(&[("progress", "0"), ("wpm", "300")]), &pairs(&[("started", "2026-10-13")])).unwrap();
    write_properties(dir, &info, &pairs(&[("progress", "50"), ("wpm", "400")]), &pairs(&[("started", "2026-11-01")])).unwrap();
    let md = std::fs::read_to_string(note_path(dir, "Demian")).unwrap();
    assert!(md.starts_with("---\ntitle: \"Demian\"\nauthor: \"Hermann Hesse\"\nsource: \"Demian.epub\"\ntags: [libro]\nprogress: 50\nwpm: 400\nstarted: 2026-10-13\n---"));
}

#[test]
fn resumen_arriba_despues_de_las_propiedades_y_sin_duplicar() {
    let dir = temp_dir("notas-resumen");
    let dir = dir.to_str().unwrap();
    let mut clips = vec![clip("Demian", "", "El pájaro.", "")];
    clips[0].description = "Un libro sobre Sinclair.\n\nSegundo párrafo.".into();
    write_clips(dir, "Kobo", &clips).unwrap();
    assert_eq!(write_clips(dir, "Kobo", &clips).unwrap(), (1, 1)); // reimportar
    let md = std::fs::read_to_string(note_path(dir, "Demian")).unwrap();
    let order: Vec<usize> = ["source: \"Kobo\"", "## Resumen", "Un libro sobre Sinclair.\n\nSegundo párrafo.", "## Kobo"].iter().map(|t| md.find(t).unwrap()).collect();
    assert!(order.windows(2).all(|w| w[0] < w[1]), "propiedades, resumen y subrayados, en ese orden");
    assert_eq!(md.matches("## Resumen").count(), 1);
}

#[test]
fn resumen_en_una_nota_que_ya_existia_va_al_principio() {
    let dir = temp_dir("notas-resumen-existente");
    let dir = dir.to_str().unwrap();
    std::fs::create_dir_all(dir).unwrap();
    std::fs::copy(format!("{RESOURCES}/Demian.md"), note_path(dir, "Demian")).unwrap(); // sin propiedades
    let info = Info { title: "Demian".into(), ..Default::default() };
    write_summary(dir, &info, "Un resumen.").unwrap();
    write_summary(dir, &info, "").unwrap(); // sin resumen: no se escribe nada
    let md = std::fs::read_to_string(note_path(dir, "Demian")).unwrap();
    assert!(md.starts_with("<!-- fastread:resumen:inicio"));
    assert!(md.contains("## Resumen\n\nUn resumen.") && md.contains("Mis ideas ANTES") && md.contains("Mis ideas DESPUÉS"));
}
