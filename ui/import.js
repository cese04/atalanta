// Importa subrayados de Kindle y Kobo a la carpeta de notas. Aquí solo se eligen los archivos
// y se avisa del resultado; leerlos, buscar los capítulos de las citas de Kindle y escribir la
// sección "## Kindle" o "## Kobo" de cada libro lo hace Rust (core/src/kindle.rs, kobo.rs y
// notes.rs). Cada importación reemplaza solo la sección de ese origen en los libros que trae.

// Dónde están los archivos cuando el lector está conectado por USB (macOS).
const KINDLE_FILE = "/Volumes/Kindle/documents/My Clippings.txt";
const KOBO_FILE = "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite";

async function importKindle() {
  if (!notesDir && !(await chooseNotesDir())) return;
  let file = KINDLE_FILE;
  if (!(await invoke("read_text", { path: file }))) {
    file = await open({
      title: "Elige My Clippings.txt (en la carpeta documents del Kindle)",
      filters: [{ name: "Recortes de Kindle", extensions: ["txt"] }],
    });
    if (!file) return;
  }
  // Kindle no guarda el capítulo: se busca la cita dentro del libro, en el propio Kindle o en
  // las carpetas de tus libros recientes (ver core/src/chapters.rs).
  const bookDirs = [...new Set([folderOf(file), ...recentBooks().map((r) => folderOf(r.path))])];
  notify("Kindle: importando y buscando los capítulos…");
  await reportImport("Kindle", invoke("import_kindle", { dir: notesDir, file, bookDirs }));
}

async function importKobo() {
  if (!notesDir && !(await chooseNotesDir())) return;
  try {
    return await reportImport("Kobo", invoke("import_kobo", { dir: notesDir, file: KOBO_FILE }), false);
  } catch {
    // no está conectado (o no en su ruta habitual): se pide el archivo
  }
  const file = await open({
    title: `Elige KoboReader.sqlite (en la carpeta oculta .kobo; ${IS_MAC ? "⌘⇧." : "Ctrl+H"} muestra las carpetas ocultas)`,
    filters: [{ name: "Base de datos de Kobo", extensions: ["sqlite"] }],
  });
  if (file) await reportImport("Kobo", invoke("import_kobo", { dir: notesDir, file }));
}

// Espera la importación y avisa: "Kobo: 177 subrayados de 9 libros importados".
// Con `showError` en false, un error se lanza en vez de avisarse.
async function reportImport(source, task, showError = true) {
  try {
    const [clips, books] = await task;
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    notify(`${source}: ${count(clips, "subrayado")} de ${count(books, "libro")} ${clips === 1 ? "importado" : "importados"}`);
  } catch (e) {
    if (!showError) throw e;
    notify(`No se pudieron importar los subrayados de ${source}: ${e}`);
  }
}

// "/Volumes/Kindle/documents/My Clippings.txt" -> "/Volumes/Kindle/documents"
const folderOf = (file) => file.replace(/[\\/][^\\/]*$/, "");
