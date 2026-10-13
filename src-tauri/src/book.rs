//! Lectura de libros EPUB y MOBI.
//!
//! Todo libro se convierte en lo mismo: una lista de palabras, dónde empieza cada
//! párrafo y un índice de capítulos. Párrafos y capítulos se indican con el
//! número de palabra donde empiezan.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

#[derive(Serialize)]
pub struct Book {
    pub title: String,
    pub author: String,
    pub description: String, // resumen del libro (de sus metadatos), en texto plano
    pub words: Vec<String>,
    pub paragraphs: Vec<usize>, // número de la primera palabra de cada párrafo
    pub kinds: Vec<&'static str>, // tipo de cada párrafo: "h1", "h2", "h3" (títulos), "quote" (cita) o ""
    pub scene_breaks: Vec<usize>, // párrafos precedidos por un separador <hr/>
    pub toc: Vec<Chapter>,
}

#[derive(Serialize)]
pub struct Chapter {
    pub title: String,
    pub level: usize, // 0 = capítulo, 1 = subcapítulo, 2 = sub-subcapítulo...
    pub word: usize,  // número de la primera palabra del capítulo
}

/// Entrada del índice antes de saber en qué palabra cae: (título, nivel, destino).
type Entry = (String, usize, String);

pub fn open(path: &str) -> Result<Book, String> {
    let lower = path.to_lowercase();
    let book = if lower.ends_with(".epub") {
        open_epub(path)?
    } else if lower.ends_with(".mobi") {
        open_mobi(path)?
    } else {
        return Err("Formato no soportado (usa .epub o .mobi)".into());
    };
    if book.words.is_empty() {
        return Err("el libro no contiene texto (¿es un cómic con solo imágenes?)".into());
    }
    Ok(book)
}

// ───────────────────────────── EPUB ─────────────────────────────
// Un EPUB es un .zip con páginas HTML, un archivo .opf (lista de páginas en
// orden) y un índice (toc.ncx en EPUB 2, nav.xhtml en EPUB 3).

fn open_epub(path: &str) -> Result<Book, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // 1. container.xml dice dónde está el archivo .opf
    let container = read_zip(&mut zip, "META-INF/container.xml")?;
    let opf_path = {
        let doc = parse_xml(&container)?;
        let rootfile = doc.descendants().find(|n| n.has_tag_name("rootfile"));
        rootfile.and_then(|n| n.attribute("full-path")).ok_or("EPUB sin archivo .opf")?.to_string()
    };
    let opf = read_zip(&mut zip, &opf_path)?;
    let doc = parse_xml(&opf)?;

    let title = doc.descendants().find(|n| n.has_tag_name("title")).and_then(|n| n.text());
    let title = title.unwrap_or("Sin título").trim().to_string();
    let author = doc.descendants().find(|n| n.has_tag_name("creator")).and_then(|n| n.text());
    let author = author.unwrap_or("").trim().to_string();
    let description = doc.descendants().find(|n| n.has_tag_name("description")).and_then(|n| n.text());
    let description = plain_text(description.unwrap_or(""));

    // 2. manifest: id -> (ruta dentro del zip, tipo, propiedades)
    let mut manifest = HashMap::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
        let href = join(&parent(&opf_path), item.attribute("href").unwrap_or(""));
        let kind = item.attribute("media-type").unwrap_or("");
        let props = item.attribute("properties").unwrap_or("");
        manifest.insert(item.attribute("id").unwrap_or(""), (href, kind, props));
    }

    // 3. spine: las páginas en orden de lectura
    let mut text = Text::default();
    for itemref in doc.descendants().filter(|n| n.has_tag_name("itemref")) {
        let Some((href, ..)) = itemref.attribute("idref").and_then(|id| manifest.get(id)) else { continue };
        if let Ok(html) = read_zip(&mut zip, href) {
            text.add_html(href, &html);
        }
    }

    // 4. índice: primero toc.ncx (EPUB 2), si no existe nav.xhtml (EPUB 3)
    let mut entries = Vec::new();
    if let Some((href, ..)) = manifest.values().find(|i| i.1 == "application/x-dtbncx+xml") {
        entries = ncx_toc(&read_zip(&mut zip, href).unwrap_or_default(), &parent(href));
    }
    if entries.is_empty() {
        if let Some((href, ..)) = manifest.values().find(|i| i.2.split_whitespace().any(|p| p == "nav")) {
            entries = nav_toc(&read_zip(&mut zip, href).unwrap_or_default(), &parent(href));
        }
    }
    Ok(Book { description, ..text.into_book(title, author, entries) })
}

/// Índice EPUB 2: <navMap><navPoint><navLabel><text>Título</text></navLabel><content src="..."/>
fn ncx_toc(xml: &str, base: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    if let Ok(doc) = parse_xml(xml) {
        if let Some(map) = doc.descendants().find(|n| n.has_tag_name("navMap")) {
            ncx_points(map, 0, base, &mut out);
        }
    }
    out
}

fn ncx_points(node: roxmltree::Node, level: usize, base: &str, out: &mut Vec<Entry>) {
    for point in node.children().filter(|n| n.has_tag_name("navPoint")) {
        let label = point.children().find(|n| n.has_tag_name("navLabel"));
        let content = point.children().find(|n| n.has_tag_name("content"));
        let src = content.and_then(|c| c.attribute("src")).unwrap_or("");
        out.push((label.map(node_text).unwrap_or_default(), level, join(base, src)));
        ncx_points(point, level + 1, base, out); // subcapítulos
    }
}

/// Índice EPUB 3: <nav epub:type="toc"><ol><li><a href="...">Título</a><ol>...</ol></li></ol></nav>
fn nav_toc(xml: &str, base: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    if let Ok(doc) = parse_xml(xml) {
        let navs: Vec<_> = doc.descendants().filter(|n| n.has_tag_name("nav")).collect();
        let toc = navs.iter().find(|n| n.attributes().any(|a| a.value() == "toc")).or(navs.first());
        if let Some(ol) = toc.and_then(|n| n.descendants().find(|c| c.has_tag_name("ol"))) {
            nav_items(ol, 0, base, &mut out);
        }
    }
    out
}

fn nav_items(ol: roxmltree::Node, level: usize, base: &str, out: &mut Vec<Entry>) {
    for li in ol.children().filter(|n| n.has_tag_name("li")) {
        if let Some(a) = li.children().find(|n| n.has_tag_name("a")) {
            out.push((node_text(a), level, join(base, a.attribute("href").unwrap_or(""))));
        }
        if let Some(sub) = li.children().find(|n| n.has_tag_name("ol")) {
            nav_items(sub, level + 1, base, out); // subcapítulos
        }
    }
}

fn read_zip(zip: &mut zip::ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut entry = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
    let mut s = String::new();
    entry.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

fn parse_xml(xml: &str) -> Result<roxmltree::Document<'_>, String> {
    let opts = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };
    roxmltree::Document::parse_with_options(xml, opts).map_err(|e| e.to_string())
}

/// Todo el texto dentro de un nodo XML, con los espacios normalizados.
fn node_text(node: roxmltree::Node) -> String {
    let parts: Vec<&str> = node.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect();
    parts.join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Une una carpeta con una ruta relativa: ("OEBPS/text", "../img/a.png") -> "OEBPS/img/a.png"
fn join(base: &str, href: &str) -> String {
    let href = href.replace("%20", " ");
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for p in href.split('/') {
        match p {
            ".." => { parts.pop(); }
            "." | "" => {}
            _ => parts.push(p),
        }
    }
    parts.join("/")
}

/// Carpeta que contiene un archivo: "OEBPS/content.opf" -> "OEBPS"
fn parent(path: &str) -> String {
    path.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default()
}

// ───────────────────────────── MOBI ─────────────────────────────
// Un MOBI es un único HTML grande. Su índice son enlaces <a filepos=N> que
// apuntan a la posición N (en bytes) dentro de ese HTML.

fn open_mobi(path: &str) -> Result<Book, String> {
    let m = mobi::Mobi::from_path(path).map_err(|e| e.to_string())?;
    let html = m.content_as_string_lossy();
    let mut links = mobi_links(&html);
    links.retain(|l| html.is_char_boundary(l.1));
    links.sort_by_key(|l| l.1); // en orden de lectura
    links.dedup_by_key(|l| l.1); // un solo título por posición

    // Partimos el HTML en cada posición a la que apunta el índice; así cada
    // trozo queda registrado con su número de palabra inicial.
    let mut text = Text::default();
    let mut start = 0;
    for cut in links.iter().map(|l| l.1).chain([html.len()]) {
        text.add_html(&start.to_string(), &html[start..cut]);
        start = cut;
    }
    let entries = links.into_iter().map(|(title, pos)| (title, 0, pos.to_string())).collect();
    let description = plain_text(&m.description().unwrap_or_default());
    Ok(Book { description, ..text.into_book(m.title(), m.author().unwrap_or_default(), entries) })
}

/// Busca los enlaces <a filepos=N>Título</a> -> [(Título, N)]
fn mobi_links(html: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for part in html.split("filepos=").skip(1) {
        let digits: String = part.trim_start_matches(['"', '\'']).chars().take_while(|c| c.is_ascii_digit()).collect();
        let (Ok(pos), Some(gt), Some(end)) = (digits.parse(), part.find('>'), part.find("</a>")) else { continue };
        if gt < end {
            let mut t = Text::default();
            t.add_html("", &part[gt + 1..end]);
            let title = t.words.join(" ");
            // Ignora enlaces sin letras, como "<<" o "[12]" (notas al pie).
            if title.chars().any(char::is_alphabetic) {
                out.push((title, pos));
            }
        }
    }
    out
}

// ─────────────────────── HTML -> palabras ───────────────────────

/// Etiquetas que no separan palabras (p. ej. la letra capital en <span>L</span>a).
const INLINE: &[&str] = &[
    "a", "b", "i", "u", "s", "em", "strong", "span", "small", "big", "sup", "sub", "font",
    "cite", "q", "abbr", "dfn", "code", "tt", "mark", "time",
];

#[derive(Default)]
struct Text {
    words: Vec<String>,
    paragraphs: Vec<usize>,          // dónde empieza cada párrafo
    anchors: HashMap<String, usize>, // "archivo" o "archivo#id" -> número de palabra
    headings: Vec<Chapter>,          // <h1>-<h3>, por si el libro no trae índice
    glue: bool,                      // el siguiente texto continúa la última palabra
    new_paragraph: bool,             // la siguiente palabra empieza un párrafo
    // Formato de los párrafos, para la vista de pausa:
    kinds: Vec<&'static str>,        // tipo de cada párrafo (ver Book::kinds)
    scene_breaks: Vec<usize>,        // párrafos precedidos por un <hr/>
    heading_level: usize,            // dentro de <h1>-<h6> (0: fuera)
    quote_depth: usize,              // dentro de cuántos <blockquote>
    scene_break: bool,               // hubo un <hr/> antes del siguiente párrafo
}

impl Text {
    /// Extrae las palabras de una página HTML. `file` es el nombre con que se
    /// registra el inicio de la página (para poder saltar a ella desde el índice).
    fn add_html(&mut self, file: &str, html: &str) {
        self.anchors.insert(file.to_string(), self.words.len());
        self.glue = false;
        self.heading_level = 0;
        self.quote_depth = 0;
        let mut skip = false; // dentro de <head>, <script> o <style>
        let mut heading: Option<(usize, usize, String)> = None; // (nivel, palabra, título)
        let mut rest = html;

        while let Some(lt) = rest.find('<') {
            if !skip {
                self.add_text(&rest[..lt], &mut heading);
            }
            // Comentario <!-- ... -->: se salta entero (puede contener < y > que no son etiquetas).
            if rest[lt..].starts_with("<!--") {
                let end = rest[lt..].find("-->").map_or(rest.len(), |e| lt + e + 3);
                rest = &rest[end..];
                continue;
            }
            let Some(gt) = rest[lt..].find('>') else { break };
            let tag = &rest[lt + 1..lt + gt];
            rest = &rest[lt + gt + 1..];

            let closing = tag.starts_with('/');
            let name = tag.trim_start_matches('/').split(|c: char| !c.is_ascii_alphanumeric()).next().unwrap_or("");
            let name = name.to_ascii_lowercase();
            // Cualquier etiqueta de bloque (<p>, <div>, <br>, <h1>...) corta palabra y párrafo.
            if !INLINE.contains(&name.as_str()) {
                self.glue = false;
                self.new_paragraph = true;
                if let Some(h) = &mut heading {
                    h.2.push(' ');
                }
            }
            if let Some(level) = name.strip_prefix('h').and_then(|n| n.parse::<usize>().ok()).filter(|l| (1..=6).contains(l)) {
                self.heading_level = if closing { 0 } else { level };
            }
            match name.as_str() {
                "head" | "script" | "style" => skip = !closing,
                "blockquote" if !closing => self.quote_depth += 1,
                "blockquote" => self.quote_depth = self.quote_depth.saturating_sub(1),
                "hr" => self.scene_break = true,
                "h1" | "h2" | "h3" if !closing => {
                    let level = name[1..].parse::<usize>().unwrap() - 1;
                    heading = Some((level, self.words.len(), String::new()));
                }
                "h1" | "h2" | "h3" => {
                    if let Some((level, word, title)) = heading.take() {
                        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
                        if !title.is_empty() {
                            self.headings.push(Chapter { title, level, word });
                        }
                    }
                }
                _ => {}
            }
            if let Some(id) = attr(tag, "id") {
                self.anchors.insert(format!("{file}#{id}"), self.words.len());
            }
        }
        if !skip {
            self.add_text(rest, &mut heading);
        }
    }

    fn add_text(&mut self, raw: &str, heading: &mut Option<(usize, usize, String)>) {
        if raw.is_empty() {
            return;
        }
        let text = decode_entities(raw);
        if let Some(h) = heading {
            h.2.push_str(&text);
        }
        let glued = self.glue && !text.starts_with(char::is_whitespace);
        for (i, word) in text.split_whitespace().enumerate() {
            match self.words.last_mut() {
                Some(last) if i == 0 && glued => last.push_str(word),
                _ => {
                    if self.new_paragraph || self.words.is_empty() {
                        self.paragraphs.push(self.words.len());
                        self.kinds.push(self.kind());
                        if self.scene_break {
                            self.scene_breaks.push(self.paragraphs.len() - 1);
                        }
                        self.scene_break = false;
                        self.new_paragraph = false;
                    }
                    self.words.push(word.to_string());
                }
            }
        }
        self.glue = !text.trim().is_empty() && !text.ends_with(char::is_whitespace);
    }

    /// Tipo del párrafo que empieza ahora: título (según su nivel; h4-h6 cuentan como h3),
    /// cita o normal.
    fn kind(&self) -> &'static str {
        match self.heading_level {
            1 => "h1",
            2 => "h2",
            3..=6 => "h3",
            _ if self.quote_depth > 0 => "quote",
            _ => "",
        }
    }

    /// Convierte el índice (destinos tipo "archivo#id") en números de palabra.
    /// Si el libro no trae índice, usa los títulos <h1>-<h3> encontrados.
    fn into_book(self, title: String, author: String, entries: Vec<Entry>) -> Book {
        let mut toc: Vec<Chapter> = entries
            .into_iter()
            .filter_map(|(title, level, target)| {
                let page = target.split('#').next().unwrap_or("");
                let word = self.anchors.get(&target).or_else(|| self.anchors.get(page))?;
                Some(Chapter { title, level, word: *word })
            })
            .collect();
        if toc.is_empty() {
            toc = self.headings;
        }
        // Muchos MOBI usan <blockquote> como simple sangría de casi todo el texto. Si más del
        // 30 % de los párrafos son "citas", es maquetación: se muestran como párrafos normales.
        let mut kinds = self.kinds;
        if kinds.iter().filter(|k| **k == "quote").count() * 10 > kinds.len() * 3 {
            kinds.iter_mut().filter(|k| **k == "quote").for_each(|k| *k = "");
        }
        Book {
            title,
            author,
            description: String::new(),
            words: self.words,
            paragraphs: self.paragraphs,
            kinds,
            scene_breaks: self.scene_breaks,
            toc,
        }
    }
}

/// HTML a texto plano (p. ej. el resumen de un libro): párrafos separados por una línea en blanco.
pub fn plain_text(html: &str) -> String {
    let mut text = Text::default();
    text.add_html("", html);
    let ends = text.paragraphs.iter().skip(1).copied().chain([text.words.len()]);
    let paragraphs: Vec<String> = text.paragraphs.iter().zip(ends).map(|(&start, end)| text.words[start..end].join(" ")).collect();
    paragraphs.join("\n\n")
}

/// Valor de un atributo dentro de una etiqueta: attr(r#"p id="x""#, "id") -> Some("x")
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let pattern = format!("{name}=");
    let (i, _) = tag.match_indices(&pattern).find(|(i, _)| tag[..*i].ends_with(char::is_whitespace))?;
    let value = &tag[i + pattern.len()..];
    let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    value[1..].split(quote).next()
}

/// Convierte "&amp;", "&#233;", "&mdash;"... en sus caracteres.
fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let entity = rest.find(';').filter(|&end| end < 10).map(|end| &rest[1..end]);
        let ch = match entity {
            Some("amp") => Some('&'),
            Some("lt") => Some('<'),
            Some("gt") => Some('>'),
            Some("quot") => Some('"'),
            Some("apos") => Some('\''),
            Some("nbsp") => Some(' '),
            Some("mdash") => Some('—'),
            Some("ndash") => Some('–'),
            Some("hellip") => Some('…'),
            Some("lsquo") => Some('‘'),
            Some("rsquo") => Some('’'),
            Some("ldquo") => Some('“'),
            Some("rdquo") => Some('”'),
            Some("laquo") => Some('«'),
            Some("raquo") => Some('»'),
            Some(e) if e.starts_with("#x") || e.starts_with("#X") => {
                u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32)
            }
            Some(e) if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match (ch, entity) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &rest[e.len() + 2..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// Pruebas: src-tauri/tests/book.rs
#[cfg(test)]
#[path = "../tests/book.rs"]
pub mod tests;
