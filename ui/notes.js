// Subrayados y notas. Se guardan en la carpeta de notas elegida, dos archivos por libro:
//   <carpeta>/<Título>.md               para leer en Obsidian. Tiene el resumen del libro
//                                       (## Resumen, si sus metadatos lo traen) y una sección por
//                                       origen (## Atalanta, ## Kindle, ## Kobo), cada una entre sus
//                                       marcas; Atalanta solo reescribe esas secciones y lo que
//                                       escribas fuera de ellas se conserva.
//   <carpeta>/.fastread/<Título>.json   los subrayados de Atalanta, que se pueden editar
//                                       (Obsidian no muestra carpetas que empiezan con punto;
//                                       ".fastread" es el nombre anterior de la app y se conserva).
// El Markdown de la nota (secciones, propiedades, resumen) lo escribe Rust (core/src/notes.rs);
// aquí quedan el modo subrayado, el editor y los datos de los subrayados de Atalanta.
// Usa `book`, `path`, `pos`, `invoke`, `open` y funciones de app.js. Kindle y Kobo: import.js.

let highlights = []; // [{ id, start, end, text, note, color, chapter, created }], ordenados por `start`
let notesDir = localStorage.getItem("notesDir") || "";
let highlighting = false; // modo subrayado
let editing = null;       // subrayado abierto en el editor
let coverSaved = false;   // la portada del libro abierto está en <carpeta>/portadas/
let drafts = new Map();   // lo escrito en el editor sin guardar: { text, note, color } por subrayado (ver draftKey)

// Colores de marcatextos (los valores están en style.css). El primero es el de siempre.
const MARK_COLORS = ["amarillo", "verde", "azul", "rosa"];
const markColor = (h) => (MARK_COLORS.includes(h.color) ? h.color : MARK_COLORS[0]);

// ── Carpeta y archivos ──

async function chooseNotesDir() {
  const dir = await open({ directory: true, title: "Carpeta de notas (por ejemplo, dentro de tu bóveda de Obsidian)" });
  if (!dir) return false;
  notesDir = dir;
  localStorage.setItem("notesDir", dir);
  if (book) {
    await loadHighlights(); // los de este libro en la carpeta nueva, si hay
    renderPage();
    show();
  }
  buildMenu();
  return true;
}

// Botón de los avisos de error al escribir en la carpeta de notas: casi siempre se arregla
// eligiéndola de nuevo (se movió, se renombró o perdió los permisos). Los subrayados del libro
// abierto se guardan tal como los ves (chooseNotesDir cargaría los de la carpeta nueva, sin el
// que no se pudo guardar).
const chooseFolder = {
  label: "Elegir carpeta de notas…",
  run: async () => {
    const unsaved = highlights;
    if (!(await chooseNotesDir()) || !book) return;
    if (unsaved.length) {
      highlights = unsaved;
      renderPage();
      show();
      await saveHighlights();
    }
    await saveReading();
  },
};

// Nombre de la nota del libro (sin ".md"); lo calcula Rust (notes::file_name en core/src/notes.rs).
const notesName = () => book.note_name;

// Datos del libro para crear su nota (título, autor y archivo de origen).
const bookInfo = () => ({ title: book.title, author: book.author, source: path.split(/[\\/]/).pop() });

async function loadHighlights() {
  highlights = [];
  if (!notesDir) return;
  const json = await invoke("read_text", { path: `${notesDir}/.fastread/${notesName()}.json` });
  try {
    highlights = JSON.parse(json).highlights || [];
  } catch {
    highlights = []; // aún no hay notas de este libro
  }
}

// Guarda los subrayados: sus datos en .fastread/<Título>.json (para poder editarlos) y la
// sección "## Atalanta" y el resumen en la nota (eso lo escribe Rust: core/src/notes.rs).
// Al terminar muestra `message` (con las opciones de notify).
async function saveHighlights(message = `Guardado en ${notesName()}.md`, options = {}) {
  const data = { title: book.title, author: book.author, source: path, highlights };
  try {
    await invoke("write_text", {
      path: `${notesDir}/.fastread/${notesName()}.json`,
      content: JSON.stringify(data, null, 2),
    });
    await invoke("notes_section", { dir: notesDir, info: bookInfo(), source: "Atalanta", clips: highlights });
    await invoke("notes_summary", { dir: notesDir, info: bookInfo(), text: book.description });
    notify(message, options);
  } catch (e) {
    notify("No se pudieron guardar las notas: " + e, { error: true, action: chooseFolder });
  }
}

// ── Propiedades de lectura ──
// Cada libro que lees tiene su nota, con estas propiedades (Obsidian las muestra arriba y
// las Bases o Dataview pueden listarlas en una tabla):
//   progress  % leído (0-100)        wpm       velocidad (palabras por minuto)
//   started   fecha en que empezaste  finished  fecha en que llegaste al final
//   cover     enlace a la portada, guardada en portadas/ (ver saveCover)
// progress y wpm se actualizan en cada pausa; started y finished se escriben una sola vez.

async function saveReading() {
  if (!book || !notesDir) return;
  const progress = Math.round((100 * pos) / Math.max(1, book.words.length - 1));
  const set = [["progress", String(progress)], ["wpm", String(wpm)]];
  if (coverSaved) set.push(["cover", `"[[${notesName()}.jpg]]"`]); // portada (en portadas/)
  const keep = [["started", startedOn()]]; // estas solo se escriben si aún no existen
  if (progress === 100) keep.push(["finished", today()]);
  try {
    await invoke("notes_properties", { dir: notesDir, info: bookInfo(), set, keep });
  } catch (e) {
    notify("No se pudo actualizar la nota: " + e, { error: true, action: chooseFolder });
  }
}

// Guarda la miniatura de la portada en <carpeta de notas>/portadas/<Título>.jpg (si aún no
// está) y la enlaza en la nota con la propiedad `cover`, que las Bases de Obsidian muestran
// en la vista de tarjetas.
async function saveCover(blob) {
  coverSaved = false;
  if (!notesDir) return;
  const file = `${notesDir}/portadas/${notesName()}.jpg`;
  try {
    await invoke("read_bytes", { path: file }); // ya existe: no se reescribe
  } catch {
    try {
      await invoke("write_bytes", { path: file, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    } catch (e) {
      return notify("No se pudo guardar la portada: " + e, { error: true, action: chooseFolder });
    }
  }
  coverSaved = true;
  await saveReading();
}

// Fecha en que se empezó el libro: la primera vez que se abrió (se recuerda por ruta).
function startedOn() {
  const key = "started:" + path;
  if (!localStorage.getItem(key)) localStorage.setItem(key, today());
  return localStorage.getItem(key);
}

const today = () => new Date().toLocaleDateString("sv-SE"); // "2026-10-12", en hora local

// ── Modo subrayado ──

function setHighlighting(on) {
  if (on && !book) return;
  if (on && timer) pause();
  if (on === highlighting) return;
  highlighting = on;
  document.querySelector("main").classList.toggle("highlighting", on);
  getSelection().removeAllRanges();
  buildMenu();
}

// Tecla S: si hay texto seleccionado, subrayarlo; si no, entrar o salir del modo subrayado.
function highlightKey() {
  const selection = getSelection();
  const range = selection.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const words = range && !timer && $("page").contains(range.commonAncestorContainer) ? selectionWords(range) : null;
  if (words) openEditor(words);
  else setHighlighting(!highlighting);
}

// En modo subrayado, al soltar el ratón tras seleccionar texto se abre el editor.
$("page").onmouseup = () => {
  if (!highlighting) return;
  const selection = getSelection();
  if (selection.isCollapsed || !selection.rangeCount) return;
  const words = selectionWords(selection.getRangeAt(0));
  if (words) openEditor(words);
};

// Palabras completas que abarca una selección: { start, end } (inclusive) o null.
function selectionWords(range) {
  const text = range.toString();
  let start = wordAt(range.startContainer, range.startOffset);
  let end = wordAt(range.endContainer, range.endOffset);
  if (start < 0 || end < 0 || !text.trim()) return null;
  const startPoint = pointInPage(range.startContainer, range.startOffset);
  const endPoint = pointInPage(range.endContainer, range.endOffset);
  if (/^\s/.test(text) || startPoint.before.length >= startPoint.length) start++; // empieza en un espacio o al final de un párrafo
  if (/\s$/.test(text) || endPoint.before === "") end--;                          // termina en un espacio o al inicio de un párrafo
  return end >= start ? { start, end } : null;
}

// Texto de las palabras `start`..`end`, con una línea en blanco entre párrafos.
function textOf(start, end) {
  const parts = [];
  for (let i = paragraphOf(start); i < book.paragraphs.length && book.paragraphs[i] <= end; i++) {
    const from = Math.max(start, book.paragraphs[i]);
    const to = Math.min(end + 1, paragraphEnd(i));
    parts.push(book.words.slice(from, to).join(" "));
  }
  return parts.join("\n\n");
}

// ── Editor ──

// Borradores: si cierras el editor sin guardar (Esc, Cancelar), lo escrito se guarda aparte y
// vuelve al reabrir ese subrayado, o la misma selección si era nuevo. Duran mientras la app
// esté abierta.
const draftKey = (h) => `${path}:${h.id || h.start + "-" + h.end}`;

// Lo que muestra el editor ahora mismo.
const editorValues = () => ({
  text: $("noteText").textContent,
  note: $("noteComment").value,
  color: document.querySelector("#noteColors input:checked")?.value || MARK_COLORS[0],
});

// Abre el editor para un subrayado nuevo ({ start, end }) o uno existente.
let editorStart = null; // los valores al abrir, para saber si cambió algo
function openEditor(h) {
  editing = h;
  const chapter = chapterAt(h.start);
  $("noteChapter").textContent = chapter < 0 ? book.title : book.toc[chapter].title;
  const color = h.id ? markColor(h) : markColor({ color: localStorage.getItem("markColor") }); // nuevo: el último usado
  editorStart = { text: h.text ?? textOf(h.start, h.end), note: h.note ?? "", color };
  const shown = drafts.get(draftKey(h)) || editorStart;
  $("noteText").textContent = shown.text;
  $("noteText").dataset.color = shown.color;
  $("noteComment").value = shown.note;
  document.querySelector(`#noteColors input[value="${shown.color}"]`).checked = true;
  $("noteDelete").hidden = !h.id;
  $("noteDialog").returnValue = "";
  $("noteDialog").showModal();
  $("noteText").focus();
}

// La cita toma el color elegido; un clic junto a ella (fuera del texto) también la edita.
$("noteColors").onchange = () => ($("noteText").dataset.color = editorValues().color);
$("noteQuote").onclick = (e) => e.target === e.currentTarget && $("noteText").focus();

// ⌘ Enter guarda.
$("noteDialog").onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("noteDialog").close("save");
};

$("noteDialog").onclose = async () => {
  getSelection().removeAllRanges();
  const h = editing;
  editing = null;
  if (!h) return;
  const result = $("noteDialog").returnValue;
  if (result !== "save") {
    // Cerrado sin guardar: si algo cambió, se conserva como borrador (salvo al eliminar).
    const now = editorValues();
    const changed = Object.keys(now).some((k) => now[k] !== editorStart[k]);
    if (changed && result !== "deleted") drafts.set(draftKey(h), now);
    else drafts.delete(draftKey(h));
    return;
  }
  const text = $("noteText").textContent.trim();
  if (!text) return;
  if (!notesDir && !(await chooseNotesDir())) {
    drafts.set(draftKey(h), editorValues()); // no se pierde: sigue en el borrador
    notify("Elige una carpeta de notas para guardar los subrayados", { action: chooseFolder });
    return;
  }
  drafts.delete(draftKey(h));
  h.text = text;
  h.note = $("noteComment").value.trim();
  h.color = document.querySelector("#noteColors input:checked")?.value || MARK_COLORS[0];
  localStorage.setItem("markColor", h.color);
  if (!h.id) {
    const chapter = chapterAt(h.start);
    h.id = "h" + Date.now().toString(36);
    h.chapter = chapter < 0 ? "" : book.toc[chapter].title;
    h.created = new Date().toISOString().slice(0, 10);
    highlights.push(h);
    highlights.sort((a, b) => a.start - b.start);
  }
  refreshParagraphs(h.start, h.end);
  await saveHighlights();
};

// Eliminar no pide confirmación: el aviso ofrece Deshacer durante unos segundos.
$("noteDelete").onclick = async () => {
  const h = editing;
  const bookPath = path;
  highlights = highlights.filter((x) => x !== h);
  $("noteDialog").close("deleted");
  refreshParagraphs(h.start, h.end);
  await saveHighlights("Subrayado eliminado", { undo: () => restoreHighlight(h, bookPath) });
};

// Deshacer: vuelve a poner el subrayado eliminado (si sigue abierto el mismo libro).
async function restoreHighlight(h, bookPath) {
  if (path !== bookPath || highlights.includes(h)) return;
  highlights.push(h);
  highlights.sort((a, b) => a.start - b.start);
  refreshParagraphs(h.start, h.end);
  await saveHighlights("Subrayado restaurado");
}
