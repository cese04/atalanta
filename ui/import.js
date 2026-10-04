// Importa subrayados de Kindle y Kobo a la carpeta de notas. Cada libro recibe una
// sección "## Kindle" o "## Kobo" en su .md (ver writeSection en notes.js).
// Cada importación reemplaza solo la sección de ese origen en los libros que trae;
// los demás libros, secciones y lo que escribas a mano no se tocan.

// Dónde están los archivos cuando el lector está conectado por USB (macOS).
const KINDLE_FILE = "/Volumes/Kindle/documents/My Clippings.txt";
const KOBO_FILE = "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite";

async function importKindle() {
  if (!notesDir && !(await chooseNotesDir())) return;
  let file = KINDLE_FILE;
  let text = await invoke("read_text", { path: file });
  if (!text) {
    file = await open({
      title: "Elige My Clippings.txt (en la carpeta documents del Kindle)",
      filters: [{ name: "Recortes de Kindle", extensions: ["txt"] }],
    });
    if (!file) return;
    text = await invoke("read_text", { path: file });
  }
  const clips = parseKindle(text);
  await addKindleChapters(clips, [folderOf(file), ...recentBooks().map((r) => folderOf(r.path))]);
  await importClips("Kindle", clips);
}

// Kindle no guarda el capítulo de cada subrayado: se busca la cita dentro del libro,
// en el propio Kindle o en las carpetas de tus libros recientes (ver chapters.rs).
async function addKindleChapters(clips, dirs) {
  const titles = [...new Set(clips.map((c) => c.title))];
  dirs = [...new Set(dirs)];
  for (const [n, title] of titles.entries()) {
    notify(`Kindle: buscando capítulos (${n + 1} de ${titles.length})…`);
    const quoted = clips.filter((c) => c.title === title && c.text);
    const chapters = await invoke("find_chapters", { title, quotes: quoted.map((c) => c.text), dirs });
    quoted.forEach((c, i) => (c.chapter = chapters[i] || ""));
  }
}

// "/Volumes/Kindle/documents/My Clippings.txt" -> "/Volumes/Kindle/documents"
const folderOf = (file) => file.replace(/[\\/][^\\/]*$/, "");

async function importKobo() {
  if (!notesDir && !(await chooseNotesDir())) return;
  let clips;
  try {
    clips = await invoke("kobo_highlights", { path: KOBO_FILE });
  } catch {
    const file = await open({
      title: "Elige KoboReader.sqlite (en la carpeta oculta .kobo; ⌘⇧. muestra las carpetas ocultas)",
      filters: [{ name: "Base de datos de Kobo", extensions: ["sqlite"] }],
    });
    if (!file) return;
    try {
      clips = await invoke("kobo_highlights", { path: file });
    } catch (e) {
      return notify("No se pudo leer la base de datos del Kobo: " + e);
    }
  }
  await importClips("Kobo", clips);
}

// Escribe los subrayados (de muchos libros) en el .md de cada libro.
// clips = [{ title, author, chapter, text, note }]
async function importClips(source, clips) {
  const books = new Map(); // título -> sus subrayados
  for (const c of clips) {
    if (!books.has(c.title)) books.set(c.title, []);
    books.get(c.title).push(c);
  }
  try {
    for (const [title, list] of books) {
      await writeSection({ title, author: list[0].author, source }, source, clipsMarkdown(source, list));
    }
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    notify(`${source}: ${count(clips.length, "subrayado")} de ${count(books.size, "libro")} ${clips.length === 1 ? "importado" : "importados"}`);
  } catch (e) {
    notify(`No se pudieron importar los subrayados de ${source}: ${e}`);
  }
}

// ── Kindle: My Clippings.txt ──
// Cada entrada está separada por "==========" y tiene esta forma (en inglés o español):
//   Demian (Hermann Hesse)
//   - Tu subrayado en la página 12 | posición 170-171 | Añadido el lunes, 3 de octubre de 2026
//
//   El pájaro rompe el cascarón.

function parseKindle(text) {
  const entries = [];
  for (const block of text.split(/\r?\n==========\r?\n?/)) {
    const lines = block.split(/\r?\n/).map((line) => line.replace(/^﻿/, "").trim());
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length < 2) continue;
    const [head, meta, ...rest] = lines;
    const byAuthor = head.match(/^(.*?)\s*\(([^()]*)\)\s*$/); // "Título (Autor)": el autor va en el último paréntesis
    const [start, end] = kindleLocation(meta);
    entries.push({
      title: (byAuthor ? byAuthor[1] : head).replace(/\s*\((?:[^()]*\bedition|edición[^()]*)\)/gi, "").trim(), // sin "(Spanish Edition)"
      author: byAuthor ? byAuthor[2].trim() : "",
      kind: /\b(note|nota)\b/i.test(meta) ? "note" : /\b(bookmark|marcador)\b/i.test(meta) ? "bookmark" : "highlight",
      start,
      end,
      text: rest.join("\n").trim(),
    });
  }
  return mergeKindle(entries);
}

// "posición 1203-1205" o "Location 1203-05" -> [1203, 1205]
function kindleLocation(meta) {
  const m = meta.match(/(?:location|loc\.|posición|posicion|position)\s*([\d.,]+)(?:\s*-\s*([\d.,]+))?/i);
  if (!m) return [0, 0];
  const number = (s) => Number(s.replace(/[.,]/g, ""));
  const start = number(m[1]);
  let end = m[2] ? number(m[2]) : start;
  if (end < start) end = Number(String(start).slice(0, -String(end).length) + String(end)); // 1203-05
  return [start, end];
}

// Kindle guarda cada cambio como una entrada nueva. Por libro:
//  - si un subrayado se amplió o recortó (su texto contiene al anterior o al revés), queda el último;
//  - una nota se une al subrayado en cuya posición está; si no hay, queda como nota suelta;
//  - los marcadores se ignoran.
function mergeKindle(entries) {
  const clips = [];
  for (const e of entries) {
    const sameBook = clips.filter((c) => c.title === e.title);
    if (e.kind === "highlight" && e.text) {
      const edited = sameBook.find((c) =>
        c.text && e.start <= c.end && e.end >= c.start && (e.text.includes(c.text) || c.text.includes(e.text)));
      if (edited) Object.assign(edited, { text: e.text, start: e.start, end: e.end });
      else clips.push({ title: e.title, author: e.author, chapter: "", text: e.text, note: "", start: e.start, end: e.end });
    } else if (e.kind === "note" && e.text) {
      const target = sameBook.find((c) => c.text && e.start >= c.start && e.start <= c.end);
      if (target) target.note = e.text;
      else clips.push({ title: e.title, author: e.author, chapter: "", text: "", note: e.text, start: e.start, end: e.start });
    }
  }
  return clips.sort((a, b) => a.title.localeCompare(b.title) || a.start - b.start);
}
