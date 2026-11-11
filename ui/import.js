// Importa subrayados de Kindle y Kobo a la carpeta de notas. Aquí solo se elige qué importar y
// se avisa del resultado; buscar el lector conectado, leer sus archivos, buscar los capítulos de
// las citas de Kindle y escribir la sección "## Kindle" o "## Kobo" de cada libro lo hace Rust
// (core/src/readers.rs, kindle.rs, kobo.rs y notes.rs). Cada importación reemplaza solo la
// sección de ese origen en los libros que trae. Los subrayados importados también se marcan en
// el texto del libro (ver loadImported en notes.js).

async function importHighlights() {
  if (!notesDir && !(await chooseNotesDir())) return;
  let { kindle, kobo } = await invoke("find_readers");
  if (!kindle && !kobo) {
    // No hay ninguno conectado (o se conecta por MTP y no aparece como disco): se pide el archivo.
    // Atajo para ver las carpetas ocultas en la ventana de archivos (Windows no tiene uno).
    const hidden = IS_MAC ? "; ⌘⇧. muestra las carpetas ocultas" : IS_LINUX ? "; Ctrl+H muestra las carpetas ocultas" : "";
    const file = await open({
      title: `Elige My Clippings.txt (Kindle, en la carpeta documents) o KoboReader.sqlite (Kobo, en la carpeta oculta .kobo${hidden})`,
      filters: [{ name: "Subrayados de Kindle o Kobo", extensions: ["txt", "sqlite"] }],
    });
    if (!file) return;
    if (/\.sqlite$/i.test(file)) kobo = file;
    else kindle = file;
  }

  notify(kindle ? "Importando y buscando los capítulos de Kindle…" : "Importando…");
  const results = [];
  let source = "";
  try {
    if (kindle) {
      source = "Kindle";
      // Kindle no guarda el capítulo: se busca la cita dentro del libro, en el propio Kindle o en
      // las carpetas de tus libros recientes (ver core/src/chapters.rs).
      const bookDirs = [...new Set([folderOf(kindle), ...recentBooks().map((r) => folderOf(r.path))])];
      results.push(importSummary(source, await invoke("import_kindle", { dir: notesDir, file: kindle, bookDirs })));
    }
    if (kobo) {
      source = "Kobo";
      results.push(importSummary(source, await invoke("import_kobo", { dir: notesDir, file: kobo })));
    }
  } catch (e) {
    return notify(`No se pudieron importar los subrayados de ${source}: ${e}`, { error: true });
  }
  notify(results.join(". "), { action: showFolder, duration: 8000 });
  if (book) {
    await loadImported(); // los del libro abierto, en su texto
    refreshParagraphs(0, book.words.length - 1);
  }
}

const showFolder = { label: "Mostrar la carpeta", run: () => invoke("open_folder", { path: notesDir }) };

// "Kindle: 12 nuevos de 177 subrayados en 9 libros · 2 libros sin capítulos (no se encontró
// su EPUB)", o "Kobo: sin subrayados nuevos (177 en 9 libros)".
function importSummary(source, { clips, books, new: fresh, missing }) {
  const count = (n, word) => `${n}\u00a0${word}${n === 1 ? "" : "s"}`; // sin partir "2 libros" en dos renglones
  const text = fresh
    ? `${source}: ${count(fresh, "nuevo")} de ${count(clips, "subrayado")} en ${count(books, "libro")}`
    : `${source}: sin subrayados nuevos (${clips}\u00a0en ${count(books, "libro")})`;
  return missing.length ? `${text} · ${count(missing.length, "libro")} sin capítulos (no se encontró su EPUB)` : text;
}

// "/Volumes/Kindle/documents/My Clippings.txt" -> "/Volumes/Kindle/documents"
const folderOf = (file) => file.replace(/[\\/][^\\/]*$/, "");
