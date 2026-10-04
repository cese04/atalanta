// Subrayados y notas. Se guardan en la carpeta de notas elegida, dos archivos por libro:
//   <carpeta>/<Título>.md               para leer en Obsidian. Tiene una sección por origen
//                                       (## FastRead, ## Kindle, ## Kobo), cada una entre sus
//                                       marcas; FastRead solo reescribe esas secciones y lo que
//                                       escribas fuera de ellas se conserva.
//   <carpeta>/.fastread/<Título>.json   los subrayados de FastRead, que se pueden editar
//                                       (Obsidian no muestra carpetas que empiezan con punto).
// Usa `book`, `path`, `pos`, `invoke`, `open` y funciones de app.js. Kindle y Kobo: import.js.

let highlights = []; // [{ id, start, end, text, note, chapter, created }], ordenados por `start`
let notesDir = localStorage.getItem("notesDir") || "";
let highlighting = false; // modo subrayado
let editing = null;       // subrayado abierto en el editor

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

// Nombre de archivo a partir de un título, sin caracteres que den problemas en Obsidian.
function fileName(title) {
  return title.replace(/[\/\\:*?"<>|#^\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Libro";
}

const notesName = () => fileName(book.title);

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

async function saveHighlights() {
  const data = { title: book.title, author: book.author, source: path, highlights };
  try {
    await invoke("write_text", {
      path: `${notesDir}/.fastread/${notesName()}.json`,
      content: JSON.stringify(data, null, 2),
    });
    const info = { title: book.title, author: book.author, source: path.split(/[\\/]/).pop() };
    await writeSection(info, "FastRead", clipsMarkdown("FastRead", highlights));
    notify(`Guardado en ${notesName()}.md`);
  } catch (e) {
    notify("No se pudieron guardar las notas: " + e);
  }
}

// Marcas que delimitan la sección de un origen ("FastRead", "Kindle", "Kobo") en el .md.
function sectionMarks(source) {
  const id = source === "FastRead" ? "fastread" : "fastread:" + source.toLowerCase();
  return [`<!-- ${id}:inicio · FastRead reescribe esta sección; escribe tus notas fuera de ella -->`, `<!-- ${id}:fin -->`];
}

// Escribe (o reemplaza) la sección `source` en el .md del libro y conserva todo lo demás.
// `info` = { title, author, source }: se usa para el nombre y las propiedades de un archivo nuevo.
async function writeSection(info, source, body) {
  const file = `${notesDir}/${fileName(info.title)}.md`;
  const old = await invoke("read_text", { path: file });
  const [start, end] = sectionMarks(source);
  const section = `${start}\n${body}\n\n${end}`;
  const a = old.indexOf(start.slice(0, start.indexOf(" ·"))); // basta con el inicio de la marca
  const b = old.indexOf(end);
  const md = a >= 0 && b > a
    ? old.slice(0, a) + section + old.slice(b + end.length)
    : (old ? old.trimEnd() + "\n\n" : frontmatter(info)) + section + "\n";
  await invoke("write_text", { path: file, content: md });
}

// Propiedades del archivo para Obsidian (solo se escriben al crearlo).
function frontmatter(info) {
  const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const lines = ["---", `title: ${quote(info.title)}`];
  if (info.author) lines.push(`author: ${quote(info.author)}`);
  lines.push(`source: ${quote(info.source)}`, "tags: [libro]", "---", "", "");
  return lines.join("\n");
}

// Subrayados como Markdown, bajo "## <origen>": agrupados por capítulo, cada uno como
// cita seguida de su comentario. Sirve para los de FastRead, Kindle y Kobo:
// cada subrayado es { text, note, chapter }.
function clipsMarkdown(source, clips) {
  const out = [`## ${source}`];
  let chapter = null;
  for (const c of clips) {
    if (c.chapter && c.chapter !== chapter) out.push("", `### ${c.chapter}`);
    chapter = c.chapter;
    if (c.text) out.push("", c.text.split("\n").map((line) => ("> " + line).trimEnd()).join("\n"));
    if (c.note) out.push("", c.note);
  }
  return out.join("\n");
}

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

// Abre el editor para un subrayado nuevo ({ start, end }) o uno existente.
function openEditor(h) {
  editing = h;
  const chapter = chapterAt(h.start);
  $("noteChapter").textContent = chapter < 0 ? book.title : book.toc[chapter].title;
  $("noteText").value = h.text ?? textOf(h.start, h.end);
  $("noteComment").value = h.note ?? "";
  $("noteDelete").hidden = !h.id;
  $("noteDialog").returnValue = "";
  $("noteDialog").showModal();
  $("noteText").focus();
}

// ⌘ Enter guarda.
$("noteDialog").onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("noteDialog").close("save");
};

$("noteDialog").onclose = async () => {
  getSelection().removeAllRanges();
  const h = editing;
  editing = null;
  if ($("noteDialog").returnValue !== "save" || !h) return;
  const text = $("noteText").value.trim();
  if (!text) return;
  if (!notesDir && !(await chooseNotesDir())) {
    notify("Elige una carpeta de notas para guardar los subrayados");
    return;
  }
  h.text = text;
  h.note = $("noteComment").value.trim();
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

$("noteDelete").onclick = async () => {
  const h = editing;
  highlights = highlights.filter((x) => x !== h);
  $("noteDialog").close("deleted");
  refreshParagraphs(h.start, h.end);
  await saveHighlights();
};
