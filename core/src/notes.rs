//! Notas de Obsidian: un `.md` por libro en la carpeta de notas. Tiene propiedades (el bloque
//! `---` del principio), el resumen del libro (`## Resumen`) y una sección por origen de los
//! subrayados (`## Atalanta`, `## Kindle`, `## Kobo`), cada una entre sus marcas. Atalanta solo
//! reescribe esas secciones y sus propiedades; lo que escribas fuera de ellas se conserva.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Un subrayado, venga de Atalanta, Kindle o Kobo.
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(default)]
pub struct Clip {
    pub title: String,       // libro
    pub author: String,
    pub chapter: String,
    pub text: String,        // texto subrayado (vacío si es solo una nota)
    pub note: String,        // comentario
    pub description: String, // resumen del libro, si se conoce
}

/// Datos del libro para el nombre de la nota y sus propiedades al crearla.
#[derive(Deserialize, Clone, Default)]
#[serde(default)]
pub struct Info {
    pub title: String,
    pub author: String,
    pub source: String, // archivo del libro, o "Kindle" / "Kobo"
}

/// Nombre de archivo a partir de un título, sin caracteres que den problemas en Obsidian.
pub fn file_name(title: &str) -> String {
    let clean: String = title.chars().filter(|c| !r#"/\:*?"<>|#^[]"#.contains(*c)).collect();
    let name: String = clean.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();
    if name.is_empty() { "Libro".to_string() } else { name }
}

/// Ruta de la nota de un libro.
pub fn note_path(dir: &str, title: &str) -> PathBuf {
    Path::new(dir).join(format!("{}.md", file_name(title)))
}

// ── Markdown ──

/// Marcas que delimitan la sección de un origen ("Atalanta", "Kindle", "Kobo", "Resumen").
/// Usan el nombre anterior de la app (`fastread`) para reconocer las notas ya escritas.
fn section_marks(source: &str) -> (String, String) {
    let id = if source == "Atalanta" { "fastread".to_string() } else { format!("fastread:{}", source.to_lowercase()) };
    (
        format!("<!-- {id}:inicio · Atalanta reescribe esta sección; escribe tus notas fuera de ella -->"),
        format!("<!-- {id}:fin -->"),
    )
}

/// Propiedades de una nota nueva.
pub fn frontmatter(info: &Info) -> String {
    let quote = |s: &str| format!("\"{}\"", s.replace('"', "\\\""));
    let mut lines = vec!["---".to_string(), format!("title: {}", quote(&info.title))];
    if !info.author.is_empty() {
        lines.push(format!("author: {}", quote(&info.author)));
    }
    lines.extend([format!("source: {}", quote(&info.source)), "tags: [libro]".into(), "---".into(), "".into(), "".into()]);
    lines.join("\n")
}

/// Subrayados como Markdown, bajo "## <origen>": agrupados por capítulo, cada uno como cita
/// seguida de su comentario.
pub fn clips_markdown(source: &str, clips: &[Clip]) -> String {
    let mut out = vec![format!("## {source}")];
    let mut chapter: Option<&str> = None;
    for c in clips {
        if !c.chapter.is_empty() && chapter != Some(c.chapter.as_str()) {
            out.extend(["".to_string(), format!("### {}", c.chapter)]);
        }
        chapter = Some(c.chapter.as_str());
        if !c.text.is_empty() {
            out.extend(["".to_string(), quote(&c.text)]);
        }
        if !c.note.is_empty() {
            out.extend(["".to_string(), c.note.clone()]);
        }
    }
    out.join("\n")
}

/// Texto como cita de Markdown: "> " delante de cada renglón.
fn quote(text: &str) -> String {
    text.split('\n').map(|line| format!("> {line}").trim_end().to_string()).collect::<Vec<_>>().join("\n")
}

/// Texto de la sección `source` de una nota, con sus marcas ("" si no la tiene).
fn section<'a>(md: &'a str, source: &str) -> &'a str {
    let (start, end) = section_marks(source);
    let start_prefix = &start[..start.find(" ·").unwrap_or(start.len())];
    match (md.find(start_prefix), md.find(&end)) {
        (Some(a), Some(b)) if b > a => &md[a..b],
        _ => "",
    }
}

/// Pone (o reemplaza) la sección `source` en el texto de una nota y conserva todo lo demás.
/// Una sección nueva va al final, o arriba (justo después de las propiedades) si `top` es true.
pub fn replace_section(old: &str, info: &Info, source: &str, body: &str, top: bool) -> String {
    let (start, end) = section_marks(source);
    let section = format!("{start}\n{body}\n\n{end}");
    let start_prefix = &start[..start.find(" ·").unwrap_or(start.len())]; // basta con el inicio de la marca
    if let (Some(a), Some(b)) = (old.find(start_prefix), old.find(&end)) {
        if b > a {
            return format!("{}{section}{}", &old[..a], &old[b + end.len()..]); // ya existía: se reemplaza
        }
    }
    if old.is_empty() {
        format!("{}{section}\n", frontmatter(info)) // nota nueva
    } else if top {
        after_frontmatter(old, &section)
    } else {
        format!("{}\n\n{section}\n", old.trim_end())
    }
}

/// Inserta `section` justo después de las propiedades (el bloque --- … ---) o al principio.
fn after_frontmatter(old: &str, section: &str) -> String {
    let at = old.strip_prefix("---\n").and_then(|rest| rest.find("\n---\n")).map_or(0, |i| 4 + i + 5);
    let rest = old[at..].trim_start_matches('\n');
    format!("{}{}{section}\n\n{rest}", &old[..at], if at > 0 { "\n" } else { "" })
}

/// Escribe propiedades en el bloque --- … --- del principio (lo crea si no hay) sin tocar las
/// demás. Las de `set` se reemplazan o añaden; las de `keep` solo se añaden si aún no existen
/// (p. ej. la fecha de inicio).
pub fn update_properties(md: &str, set: &[(String, String)], keep: &[(String, String)]) -> String {
    let block = md.strip_prefix("---\n").and_then(|rest| {
        if rest.starts_with("---\n") {
            Some((String::new(), 8)) // bloque vacío
        } else {
            rest.find("\n---\n").map(|i| (rest[..i].to_string(), 4 + i + 5))
        }
    });
    let (mut lines, rest): (Vec<String>, String) = match &block {
        Some((content, len)) => (content.split('\n').filter(|l| !l.is_empty()).map(String::from).collect(), md[*len..].to_string()),
        None => (Vec::new(), format!("\n{md}")),
    };
    let position = |lines: &[String], key: &str| lines.iter().position(|l| l.starts_with(&format!("{key}:")));
    for (key, value) in set {
        match position(&lines, key) {
            Some(i) => lines[i] = format!("{key}: {value}"),
            None => lines.push(format!("{key}: {value}")),
        }
    }
    for (key, value) in keep {
        if position(&lines, key).is_none() {
            lines.push(format!("{key}: {value}"));
        }
    }
    format!("---\n{}\n---\n{rest}", lines.join("\n"))
}

// ── Archivos ──

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

fn write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// Escribe (o reemplaza) la sección `source` en la nota del libro.
pub fn write_section(dir: &str, info: &Info, source: &str, body: &str, top: bool) -> Result<(), String> {
    let path = note_path(dir, &info.title);
    write(&path, &replace_section(&read(&path), info, source, body, top))
}

/// Escribe los subrayados de un origen en la nota del libro.
pub fn write_clips_section(dir: &str, info: &Info, source: &str, clips: &[Clip]) -> Result<(), String> {
    write_section(dir, info, source, &clips_markdown(source, clips), false)
}

/// Resumen del libro en su propia sección, arriba de los subrayados (nada si está vacío).
pub fn write_summary(dir: &str, info: &Info, text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    write_section(dir, info, "Resumen", &format!("## Resumen\n\n{text}"), true)
}

/// Actualiza propiedades de la nota del libro, creándola si no existe. Solo escribe si cambia.
pub fn write_properties(dir: &str, info: &Info, set: &[(String, String)], keep: &[(String, String)]) -> Result<(), String> {
    let path = note_path(dir, &info.title);
    let old = read(&path);
    let base = if old.is_empty() { frontmatter(info) } else { old.clone() };
    let md = update_properties(&base, set, keep);
    if md != old { write(&path, &md) } else { Ok(()) }
}

/// Resultado de importar de Kindle o Kobo, para el aviso de la interfaz (ui/import.js).
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Imported {
    pub clips: usize,         // subrayados
    pub books: usize,         // libros
    pub new: usize,           // subrayados que no estaban en la nota
    pub missing: Vec<String>, // libros de Kindle sin capítulos: no se encontró el libro (ver kindle.rs)
}

/// Archivo con los subrayados importados de un libro, para marcarlos en su texto (ui/notes.js):
/// <carpeta>/.fastread/Kindle/<Título>.json o .fastread/Kobo/<Título>.json.
pub fn imported_path(dir: &str, source: &str, title: &str) -> PathBuf {
    Path::new(dir).join(".fastread").join(source).join(format!("{}.json", file_name(title)))
}

/// Escribe los subrayados de muchos libros (de Kindle o Kobo) en la nota de cada uno, con su
/// resumen si lo traen, y en el archivo de imported_path. Un subrayado es nuevo si su cita (o su
/// comentario, si no tiene cita) no estaba en la sección de ese origen.
pub fn write_clips(dir: &str, source: &str, clips: &[Clip]) -> Result<Imported, String> {
    let mut books: Vec<(String, Vec<Clip>)> = Vec::new(); // en el orden en que aparecen
    for c in clips {
        match books.iter_mut().find(|(t, _)| *t == c.title) {
            Some((_, list)) => list.push(c.clone()),
            None => books.push((c.title.clone(), vec![c.clone()])),
        }
    }
    let mut new = 0;
    for (title, list) in &books {
        let info = Info { title: title.clone(), author: list[0].author.clone(), source: source.to_string() };
        let old = read(&note_path(dir, title));
        let old = section(&old, source);
        new += list.iter().filter(|c| !old.contains(&if c.text.is_empty() { c.note.clone() } else { quote(&c.text) })).count();
        write_clips_section(dir, &info, source, list)?;
        let description = list.iter().find(|c| !c.description.is_empty()).map_or("", |c| c.description.as_str());
        write_summary(dir, &info, description)?;
        let saved: Vec<Clip> = list.iter().map(|c| Clip { description: String::new(), ..c.clone() }).collect(); // el resumen ya está en la nota
        write(&imported_path(dir, source, title), &serde_json::to_string_pretty(&saved).map_err(|e| e.to_string())?)?;
    }
    Ok(Imported { clips: clips.len(), books: books.len(), new, missing: Vec::new() })
}

// Pruebas: core/tests/notes.rs
#[cfg(test)]
#[path = "../tests/notes.rs"]
mod tests;
