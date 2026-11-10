// FastRead: muestra un libro palabra por palabra. Al pausar, la palabra "vuela" a su
// lugar en el texto completo, que se puede recorrer y donde un clic elige desde dónde seguir.
//
// Archivos de la interfaz:
//   app.js     lectura, vistas, índice, ajustes y teclado (este archivo)
//   pdf-reader.js  abrir PDF (con pdf.js) y convertirlos en la misma estructura que los EPUB
//   rhythm.js  cuánto dura cada palabra y qué es diálogo
//   notes.js   subrayados y notas para Obsidian
//   menu.js    menú principal y libros recientes
//
// Lo guardado entre sesiones vive en localStorage:
//   "wpm"         -> velocidad (palabras por minuto)
//   "theme"       -> tema de colores
//   "fontScale"   -> tamaño de letra, en % del normal
//   "font"        -> tipo de letra elegido (ver FONTS) o "auto": el del tema (ver THEMES)
//   "sidebar", "chart", "context", "natural" -> "1" / "" (ver `toggles`)
//   "notesDir"    -> carpeta de notas
//   "markColor"   -> último color de marcatextos usado
//   "recent"      -> libros recientes
//   "last"        -> ruta del último libro abierto
//   "pos:<ruta>"  -> palabra donde te quedaste en ese libro
//   "started:<ruta>" -> fecha en que se abrió por primera vez (propiedad `started` de la nota)

const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const $ = (id) => document.getElementById(id);

let book = null;   // { title, author, description, words, paragraphs, kinds, scene_breaks, toc: [{ title, level, word }] }
let path = null;   // ruta del libro abierto
let pos = 0;       // número de la palabra actual
let timer = null;  // distinto de null mientras se está leyendo
let busy = false;  // true durante la animación entre vistas
let chapterStarts = new Map(); // número de palabra -> capítulo que empieza ahí
let rampLeft = 0;  // palabras que faltan del arranque gradual
let pausedAt = 0;  // cuándo se pausó (0: no en esta sesión, p. ej. al abrir un libro)
let chosen = false; // si en la pausa se eligió otra palabra (clic, flechas, índice…)
let natural = true; // "Ritmo natural" (ver rhythm.js)
let wordStyles = new Uint8Array(0); // estilo de cada palabra del libro en la vista de pausa (cursiva, negrita…)
let wpm = Number(localStorage.getItem("wpm")) || 300;
let lengths = [];  // palabras de cada capítulo (mismo orden que book.toc)

// ── Abrir libro ──

async function chooseBook() {
  const p = await open({ filters: [{ name: "Libros", extensions: ["epub", "mobi", "pdf"] }] });
  if (p) openBook(p);
}

async function openBook(p) {
  stopTimer();
  await saveReading(); // progreso del libro que se deja, si se estaba leyendo
  setHighlighting(false);
  const name = p.split(/[\\/]/).pop();
  $("msg").textContent = "Cargando…";
  const loading = notify(`Abriendo ${name}…`, { duration: 0 }); // se ve también en pausa
  setLoading(true);
  const pages = (n, total) => {
    $("msg").textContent = `Leyendo el PDF… página ${n} de ${total}`;
    setLoading(n / total);
  };
  try {
    book = p.toLowerCase().endsWith(".pdf")
      ? await openPdf(p, pages) // ver pdf-reader.js
      : await invoke("open_book", { path: p });
  } catch (e) {
    setLoading(false);
    $("msg").textContent = "No se pudo abrir el libro: " + e;
    notify(`No se pudo abrir ${name}: ${e}`, { error: true });
    setPaused(false); // muestra el mensaje
    localStorage.removeItem("last");
    removeRecent(p);
    return;
  }
  setLoading(false);
  hideToast(loading);
  path = p;
  localStorage.setItem("last", p);
  $("msg").textContent = "";
  $("open").hidden = true;
  $("title").textContent = book.title;
  $("progress").max = book.words.length - 1;
  chapterStarts = new Map();
  for (const ch of book.toc) {
    const other = chapterStarts.get(ch.word);
    if (!other || ch.level < other.level) chapterStarts.set(ch.word, ch); // gana el de nivel más alto
  }
  separators = new Set(book.rhythm.separators); // ver rhythm.js
  wordStyles = expandStyles(book.styles, book.words.length);
  await loadHighlights();
  renderToc();
  renderPage();
  setPaused(true); // un libro recién abierto empieza en pausa, mostrando el texto
  goTo(Number(localStorage.getItem("pos:" + p)) || 0);
  pausedAt = 0; // al abrir un libro cuenta como una pausa larga: se retoma desde el inicio de la frase
  chosen = false;
  addRecent();
  saveReading(); // crea la nota del libro (si no existe) con su fecha de inicio
  loadCover();
}

// ── Portada ──
// Al principio del texto (en la pausa) y en el panel del índice; además se guarda como
// miniatura en la carpeta de notas y se enlaza en la nota del libro (ver saveCover en notes.js).

const COVER_HEIGHT = 900; // alto máximo de la miniatura, en píxeles
let coverUrl = null;      // miniatura del libro abierto (URL blob:)

async function loadCover() {
  const opened = book;
  setCover(null);
  const original = book.coverBlob || (await coverFromFile(path)); // PDF: la primera página (pdf-reader.js)
  const thumb = original && (await shrinkImage(original, COVER_HEIGHT));
  if (!thumb || book !== opened) return; // sin portada, o ya se abrió otro libro
  setCover(thumb);
  await saveCover(thumb.blob);
}

async function coverFromFile(file) {
  const bytes = new Uint8Array(await invoke("book_cover", { path: file }));
  return bytes.length ? new Blob([bytes], { type: imageType(bytes) }) : null;
}

// Tipo de imagen según sus primeros bytes (dentro del libro no siempre se indica).
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "";
}

// Reduce una imagen a `height` px de alto como máximo, en JPEG: { blob, width, height } o null.
async function shrinkImage(blob, height) {
  try {
    const image = await createImageBitmap(blob);
    const scale = Math.min(1, height / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff"; // fondo blanco para las imágenes con transparencia
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return jpeg && { blob: jpeg, width: canvas.width, height: canvas.height };
  } catch {
    return null; // imagen que no se puede leer
  }
}

// Muestra la portada (o la quita, con null). Mantiene a la vista la palabra actual aunque
// la portada empuje el texto hacia abajo.
function setCover(thumb) {
  const before = $("cur")?.getBoundingClientRect().top;
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  coverUrl = thumb ? URL.createObjectURL(thumb.blob) : null;
  for (const img of [$("cover").querySelector("img"), $("coverThumb")]) {
    img.src = coverUrl || "";
    if (thumb) Object.assign(img, { width: thumb.width, height: thumb.height }); // reserva su espacio
  }
  $("cover").hidden = $("coverThumb").hidden = !coverUrl;
  if (before !== undefined && $("cur")) $("page").scrollTop += $("cur").getBoundingClientRect().top - before;
}

// ── Índice ──

// Cada fila: título, minutos estimados y una barra proporcional a ellos,
// rellena según la parte ya leída.
function renderToc() {
  lengths = chapterLengths();
  const longest = Math.max(1, ...lengths);
  $("toc").innerHTML = "";
  book.toc.forEach((chapter, i) => {
    const li = document.createElement("li");
    li.style.paddingLeft = chapter.level * 0.875 + "rem"; // sangría para subcapítulos
    li.innerHTML = `<span></span><span class="time"></span><div class="bar"><div class="fill"></div></div>`;
    li.children[0].textContent = chapter.title;
    li.children[1].textContent = formatMinutes(lengths[i] / wpm);
    li.children[2].style.width = (100 * lengths[i]) / longest + "%";
    li.tabIndex = -1; // con el teclado se llega por tocKey
    li.onclick = () => goTo(chapter.word);
    li.onmousedown = (e) => e.preventDefault(); // un clic no lo enfoca: las flechas siguen siendo del lector
    $("toc").append(li);
  });
  $("info").textContent = `${formatMinutes(book.words.length / wpm)} de lectura a ${wpm} palabras/min`;
  currentLi = null;
  setTocStop($("toc").firstElementChild);
  renderTicks();
}

// El índice es una sola parada de Tab: solo un capítulo tiene tabIndex 0 (el actual, o el
// último al que se movió el teclado). Dentro, ↑ ↓ Inicio Fin mueven y Enter abre el capítulo.
let tocStop = null;
function setTocStop(li) {
  if (tocStop) tocStop.tabIndex = -1;
  if (li) li.tabIndex = 0;
  tocStop = li;
}

// Tecla con el foco en un capítulo del índice. Devuelve true si la usó.
function tocKey(e) {
  const items = [...$("toc").children].filter((li) => !li.hidden);
  const i = items.indexOf(e.target);
  const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 }[e.key];
  if (e.key === "Enter") e.target.click();
  else if (items[to]) {
    setTocStop(items[to]);
    items[to].focus();
  } else return to !== undefined; // en el primero o el último, ↑ ↓ no hacen nada
  return true;
}

// Palabras de cada capítulo: desde su inicio hasta el siguiente capítulo
// del mismo nivel o superior (así un capítulo incluye a sus subcapítulos).
function chapterLengths() {
  return book.toc.map((chapter) => {
    let end = book.words.length;
    for (const other of book.toc) {
      if (other.word > chapter.word && other.level <= chapter.level && other.word < end) end = other.word;
    }
    return end - chapter.word;
  });
}

// Índice (en book.toc) del capítulo que contiene la palabra `index`: el último que empieza antes (-1 si no hay).
function chapterAt(index) {
  let best = -1;
  book.toc.forEach((ch, i) => {
    if (ch.word <= index && (best < 0 || ch.word >= book.toc[best].word)) best = i;
  });
  return best;
}

// Salta al capítulo anterior (-1) o siguiente (1).
function jumpChapter(direction) {
  if (!book) return;
  const starts = [...new Set(book.toc.map((ch) => ch.word))].sort((a, b) => a - b);
  const target = direction > 0 ? starts.find((w) => w > pos) : starts.filter((w) => w < pos).pop();
  if (target !== undefined) goTo(target);
}

// 0.4 -> "<1 min" · 25 -> "25 min" · 135 -> "2 h 15"
function formatMinutes(min) {
  min = Math.round(min);
  if (min < 1) return "<1 min";
  if (min < 60) return min + " min";
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

// ── Vista de pausa: el libro como texto ──

// Un <p> por párrafo. Las palabras no llevan etiqueta propia (serían cientos de miles);
// al hacer clic se calcula cuál es (ver wordAt).
function renderPage() {
  const chapters = new Set(book.toc.map((ch) => ch.word));
  const breaks = new Set(book.scene_breaks);
  const fragment = document.createDocumentFragment();
  book.paragraphs.forEach((start, i) => {
    const p = document.createElement("p");
    p.append(...paragraphNodes(i));
    p.className = paragraphClass(i, chapters, breaks);
    fragment.append(p);
  });
  $("text").replaceChildren(fragment);
  marked = pos < book.words.length ? paragraphOf(pos) : -1;
}

// Formato de un párrafo en la vista de pausa (clases de CSS en style.css):
//   h1 h2 h3 título · quote cita · chapter inicio de capítulo · scene tras un separador <hr/>
//   separator un párrafo que es solo un separador, como "* * *"
function paragraphClass(i, chapters, breaks) {
  const classes = [book.kinds[i]];
  if (chapters.has(book.paragraphs[i])) classes.push("chapter");
  if (breaks.has(i)) classes.push("scene");
  if (isSeparator(i)) classes.push("separator");
  return classes.filter(Boolean).join(" ");
}

// Estilos del libro dentro del texto (los mismos valores que STYLE_* en book.rs) y su clase de CSS.
const STYLE_CLASSES = [[1, "italic"], [2, "bold"], [4, "larger"], [8, "smaller"]];
const styleClass = (style) => STYLE_CLASSES.filter(([bit]) => style & bit).map(([, name]) => name).join(" ");

// Tramos de estilo del libro [[desde, hasta sin incluir, estilo], …] -> estilo de cada palabra.
function expandStyles(runs, count) {
  const styles = new Uint8Array(count);
  for (const [from, to, style] of runs) styles.fill(style, from, to);
  return styles;
}

// Contenido de un párrafo: texto normal, texto con estilo del libro (<span class="italic">…),
// subrayados (<span class="hl" data-color="…">, que se ven como marcatextos) y la palabra
// actual (<span id="cur">).
function paragraphNodes(i) {
  const start = book.paragraphs[i];
  const end = paragraphEnd(i);
  const marks = highlights.filter((h) => h.start < end && h.end >= start);
  const styled = wordStyles.subarray(start, end).some(Boolean);
  if (!marks.length && !styled && (pos < start || pos >= end)) return [paragraphText(i)];

  // Agrupa palabras seguidas con el mismo estilo en un solo nodo.
  const nodes = [];
  let words = [], key = null, mark = null, current = false, style = 0, lastMark = null;
  const span = (text, mark, style) => {
    const node = document.createElement("span");
    node.textContent = text;
    node.className = [mark ? "hl" : "", styleClass(style)].filter(Boolean).join(" ");
    if (mark) {
      node.dataset.id = mark.id;
      node.dataset.color = markColor(mark);
    }
    return node;
  };
  const flush = () => {
    if (!words.length) return;
    // El espacio entre dos trozos del mismo subrayado también va marcado, para que no queden huecos.
    if (nodes.length) nodes.push(mark && mark === lastMark ? span(" ", mark, 0) : " ");
    const text = words.join(" ");
    if (!mark && !current && !style) {
      nodes.push(text);
    } else {
      const node = span(text, mark, style);
      if (current) node.id = "cur";
      nodes.push(node);
    }
    lastMark = mark;
    words = [];
  };
  for (let w = start; w < end; w++) {
    const m = marks.find((h) => w >= h.start && w <= h.end) || null;
    const k = (m ? m.id : "") + "|" + wordStyles[w] + (w === pos ? "*" : "");
    if (k !== key) {
      flush();
      key = k;
      mark = m;
      current = w === pos;
      style = wordStyles[w];
    }
    words.push(book.words[w]);
  }
  flush();
  return nodes;
}

// Vuelve a dibujar los párrafos entre dos palabras (p. ej. tras cambiar un subrayado).
function refreshParagraphs(from, to) {
  for (let i = paragraphOf(from); i <= paragraphOf(to); i++) {
    $("text").children[i].replaceChildren(...paragraphNodes(i));
  }
}

const paragraphEnd = (i) => book.paragraphs[i + 1] ?? book.words.length;
const paragraphText = (i) => book.words.slice(book.paragraphs[i], paragraphEnd(i)).join(" ");
const isParagraphStart = (w) => w < book.words.length && book.paragraphs[paragraphOf(w)] === w;

// Número del párrafo que contiene la palabra `index` (búsqueda binaria).
function paragraphOf(index) {
  let lo = 0, hi = book.paragraphs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (book.paragraphs[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Mueve la marca de la palabra actual (<span id="cur">) a su párrafo.
let marked = -1; // párrafo que tiene la marca ahora
function markWord() {
  const i = paragraphOf(pos);
  if (marked >= 0 && marked !== i) $("text").children[marked].replaceChildren(...paragraphNodes(marked));
  $("text").children[i].replaceChildren(...paragraphNodes(i));
  marked = i;
}

// Desplaza el texto hasta la palabra marcada; si `always` es falso, solo si no está a la vista.
function scrollToWord(always) {
  const word = $("cur").getBoundingClientRect();
  const view = $("page").getBoundingClientRect();
  if (always || word.top < view.top || word.bottom > view.bottom) {
    $("cur").scrollIntoView({ block: "center" });
  }
}

// Para un punto del texto (nodo, desplazamiento): su párrafo y el texto anterior dentro de él.
function pointInPage(node, offset) {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const p = element?.closest("#text > p");
  if (!p) return null;
  const range = document.createRange();
  range.setStart(p, 0);
  range.setEnd(node, offset);
  return { i: Array.prototype.indexOf.call($("text").children, p), before: range.toString(), length: p.textContent.length };
}

// Número de la palabra en un punto del texto: la que tiene tantos espacios
// antes como hay desde el inicio del párrafo hasta ese punto.
function wordAt(node, offset) {
  const point = pointInPage(node, offset);
  if (!point) return -1;
  const spaces = point.before.split(" ").length - 1;
  return Math.min(book.paragraphs[point.i] + spaces, paragraphEnd(point.i) - 1);
}

// Clic en el texto: seguir leyendo desde esa palabra (en modo subrayado, editar el subrayado).
$("page").onclick = (e) => {
  if (!book || timer || busy || $("noteDialog").open || !getSelection().isCollapsed) return;
  if (highlighting) {
    const mark = e.target.closest(".hl");
    if (mark) openEditor(highlights.find((h) => h.id === mark.dataset.id));
    return;
  }
  const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
  const w = caret ? wordAt(caret.startContainer, caret.startOffset) : -1;
  if (w >= 0) goTo(w);
};

// ── Mostrar palabra ──

function goTo(i) {
  pos = Math.max(0, Math.min(i, book.words.length - 1));
  show();
  if (!timer && !busy) {
    chosen = true; // en pausa, ir a otra palabra es elegir desde dónde seguir
    markWord();
    scrollToWord(false);
  }
}

function show() {
  const letters = [...book.words[pos]];
  // Letra "ancla": queda fija en el centro para que el ojo no se mueva.
  const n = letters.length;
  const a = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3;
  $("left").textContent = letters.slice(0, a).join("");
  $("pivot").textContent = letters[a] || "";
  $("right").textContent = letters.slice(a + 1).join("");
  $("prev").textContent = book.words[pos - 1] || "";
  $("next").textContent = book.words[pos + 1] || "";
  $("word").classList.toggle("speech", natural && isSpeech(pos)); // diálogo en cursiva
  const mark = highlights.find((h) => pos >= h.start && pos <= h.end); // palabra subrayada: con su color
  if (mark) $("word").setAttribute("data-color", markColor(mark));
  else $("word").removeAttribute("data-color");

  // Progreso del libro y del capítulo actual
  const total = book.words.length;
  $("progress").value = pos;
  $("progress").setAttribute("aria-valuetext", `${percent(pos, total)} del libro`);
  $("bookStatus").hidden = false;
  $("bookValue").textContent = `${percent(pos, total)} · quedan ${formatMinutes((total - pos) / wpm)}`;
  const c = chapterAt(pos);
  $("head").textContent = c < 0 ? "" : book.toc[c].title;
  const chapterLeft = c < 0 ? 0 : book.toc[c].word + lengths[c] - pos;
  $("chapterStatus").hidden = c < 0;
  $("chapterValue").textContent =
    c < 0 ? "" : `${percent(pos - book.toc[c].word, lengths[c])} · quedan ${formatMinutes(chapterLeft / wpm)}`;
  $("chapterFill").style.width = 100 * chapterProgress(c) + "%";

  highlightChapter(c);
  fillBars();
  localStorage.setItem("pos:" + path, pos);
}

// Parte leída (0 a 1) del capítulo número `c` de book.toc; 0 si no hay capítulo.
function chapterProgress(c) {
  if (c < 0) return 0;
  return Math.min(1, Math.max(0, (pos - book.toc[c].word) / Math.max(1, lengths[c])));
}

// 45 de 100 -> "45 %"
function percent(part, whole) {
  return Math.floor((100 * part) / Math.max(1, whole)) + " %";
}

// Rellena cada barra del índice con la parte leída de su capítulo.
function fillBars() {
  const items = $("toc").children;
  book.toc.forEach((ch, i) => {
    const read = Math.min(1, Math.max(0, (pos - ch.word) / Math.max(1, lengths[i])));
    items[i].querySelector(".fill").style.width = read * 100 + "%";
  });
}

// Qué filas del índice se ven con el capítulo número `c` de book.toc abierto: los capítulos
// principales y solo los subcapítulos del actual. Los que van antes del primer capítulo
// principal no tienen bajo cuál plegarse y se ven siempre.
function visibleChapters(toc, c) {
  const top = Math.min(...toc.map((ch) => ch.level));
  let main = c;
  while (main > 0 && toc[main].level > top) main--;
  let open = true;
  return toc.map((ch, i) => {
    if (ch.level === top) open = i === main;
    return ch.level === top || open;
  });
}

function foldToc(c) {
  const items = $("toc").children;
  visibleChapters(book.toc, c).forEach((shown, i) => (items[i].hidden = !shown));
  if (tocStop?.hidden) setTocStop(items[c] || items[0]); // que Tab siga pudiendo entrar al índice
}

// Marca en el índice el capítulo actual.
let currentLi = null;
function highlightChapter(index) {
  foldToc(index);
  const li = $("toc").children[index] || null;
  if (li === currentLi) return;
  currentLi?.classList.remove("current");
  currentLi?.removeAttribute("aria-current");
  li?.classList.add("current");
  li?.setAttribute("aria-current", "true");
  li?.scrollIntoView({ block: "nearest" });
  if (li && !$("toc").contains(document.activeElement)) setTocStop(li); // Tab entra por el capítulo actual
  currentLi = li;
  renderTicks(); // las marcas de los subcapítulos siguen al capítulo actual
}

// ── Marcas de capítulo en la barra del libro ──

// Dónde van las marcas (0 a 1 del libro): una por capítulo principal y, solo dentro del
// capítulo actual, una corta (`sub`) por subcapítulo. Se omiten las que quedarían a menos de
// `minGap` (en fracción del ancho) de la anterior, para que un libro con muchos capítulos no
// se llene de rayas. El principio del libro no lleva marca.
function tickPositions(toc, total, pos, minGap) {
  if (total < 2) return [];
  const sorted = [...toc].sort((a, b) => a.word - b.word);
  const top = Math.min(...sorted.map((ch) => ch.level)); // nivel de los capítulos principales
  const mains = sorted.filter((ch) => ch.level === top);
  const current = mains.filter((ch) => ch.word <= pos).pop();
  const end = current ? mains.find((ch) => ch.word > current.word)?.word ?? total : 0;
  const subs = current ? sorted.filter((ch) => ch.level > top && ch.word > current.word && ch.word < end) : [];
  const ticks = [];
  for (const [list, sub] of [[mains, false], [subs, true]]) {
    let last = 0;
    for (const ch of list) {
      const at = ch.word / (total - 1);
      if (at <= 0 || at - last < minGap) continue;
      ticks.push({ at, sub });
      last = at;
    }
  }
  return ticks;
}

// Dibuja las marcas detrás del deslizador del libro. El centro del punto del deslizador no
// llega a los bordes (se queda a medio punto, 0.28125rem), así que las marcas tampoco.
function renderTicks() {
  if (!book) return;
  const width = Number($("bookBar").clientWidth) || 1;
  const ticks = tickPositions(book.toc, book.words.length, pos, 4 / width); // al menos 4 px entre marcas
  $("ticks").replaceChildren(
    ...ticks.map(({ at, sub }) => {
      const tick = document.createElement("div");
      tick.className = sub ? "tick sub" : "tick";
      tick.style.left = `calc(0.28125rem + (100% - 0.5625rem) * ${at})`;
      return tick;
    })
  );
}
window.addEventListener("resize", renderTicks); // con otro ancho caben más o menos marcas

// ── Leer / pausar ──

async function play() {
  if (!book || timer || busy) return;
  setHighlighting(false);
  $("play").textContent = "Pausa";
  const from = resumeFrom(pos, Date.now() - pausedAt, chosen); // tras una pausa larga: inicio de la frase
  if (from !== pos) {
    pos = from;
    show();
    markWord();
    scrollToWord(false);
  }
  await switchView(false, $("cur").getBoundingClientRect(), readerWordRect());
  rampLeft = RAMP_WORDS; // al retomar también se arranca de forma gradual
  tick();
}

function pause() {
  if (!timer) return;
  stopTimer();
  pausedAt = Date.now();
  chosen = false;
  show(); // por si se pausó durante un cambio de capítulo
  const from = readerWordRect();
  markWord();
  scrollToWord(true);
  switchView(true, from, $("cur").getBoundingClientRect());
  buildMenu(); // actualiza el % leído en "Abrir reciente"
  saveReading(); // progreso y velocidad en la nota del libro
}

function stopTimer() {
  clearTimeout(timer);
  timer = null;
  $("play").textContent = "Leer";
  $("reader").classList.remove("blank", "titled", "blink");
}

function toggle() {
  if (busy) return;
  timer ? pause() : play();
}

// Muestra la palabra actual y programa la siguiente (el tiempo lo decide rhythm.js).
function tick() {
  show();
  if (pos >= book.words.length - 1) return pause();
  timer = setTimeout(advance, delayFor(pos));
}

function advance() {
  pos++;
  const chapter = chapterStarts.get(pos);
  if (chapter && chapter.level === 0) return chapterBreak(chapter);
  if (chapter) rampLeft = RAMP_WORDS; // subcapítulo: solo arranque gradual
  if (natural && isParagraphStart(pos)) {
    return isSeparator(paragraphOf(pos)) ? sectionBreak() : blink();
  }
  tick();
}

// Párrafo nuevo: la palabra desaparece un instante, como la sangría de un libro.
function blink() {
  $("reader").classList.add("blink");
  timer = setTimeout(() => {
    $("reader").classList.remove("blink");
    tick();
  }, BLINK_MS);
}

// Separador de sección (* * *): respiro sin tarjeta, se salta el separador y arranque gradual.
function sectionBreak() {
  $("reader").classList.add("blank");
  timer = setTimeout(() => {
    $("reader").classList.remove("blank");
    pos = Math.min(paragraphEnd(paragraphOf(pos)), book.words.length - 1);
    rampLeft = RAMP_WORDS;
    tick();
  }, BREATH_MS);
}

// Nuevo capítulo: respiro (pantalla vacía), tarjeta con el título y arranque gradual.
function chapterBreak(chapter) {
  $("reader").classList.add("blank");
  timer = setTimeout(() => {
    const [label, title] = splitChapterTitle(chapter.title);
    $("cardLabel").textContent = label;
    $("cardTitle").textContent = title;
    $("reader").classList.replace("blank", "titled");
    timer = setTimeout(() => {
      $("reader").classList.remove("titled");
      pos = skipTitle(pos, chapter.title);
      rampLeft = RAMP_WORDS;
      tick();
    }, CARD_MS);
  }, BREATH_MS);
}

// "Capítulo III. Objeto de la lingüística" -> ["Capítulo III", "Objeto de la lingüística"].
// Si no empieza así ("Prefacio", "Primera parte"), no hay rótulo: ["", título].
function splitChapterTitle(title) {
  const m = title.match(/^((?:cap[ií]tulo|chapter|parte|part|libro|book)\s+[\p{L}\d]+)\s*[.:—–-]\s+(.+)$/iu);
  return m ? [m[1], m[2]] : ["", title];
}

// Si el texto empieza repitiendo el título (ya mostrado en la tarjeta), lo salta.
// Solo si el título coincide completo y ocupa su propio párrafo; si no, no salta nada.
function skipTitle(start, title) {
  const clean = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let i = start;
  for (const t of title.split(/\s+/).map(clean).filter(Boolean)) {
    while (i < book.words.length - 1 && !clean(book.words[i])) i++; // ignora signos sueltos
    if (clean(book.words[i]) !== t) return start;
    i++;
  }
  const endsParagraph = i < book.words.length && book.paragraphs[paragraphOf(i)] === i;
  return endsParagraph ? i : start;
}

// ── Transición entre vistas ──

function setPaused(paused) {
  document.querySelector("main").classList.toggle("paused", paused);
}

// Cambia de vista. Mientras se cruzan con un desvanecido, una copia de la palabra
// vuela de `from` a `to` (del lector al párrafo al pausar, al revés al reanudar).
async function switchView(paused, from, to) {
  busy = true;
  setPaused(paused);
  const sizes = [fontSize($("word")), fontSize($("cur"))]; // la palabra en el texto puede estar en un título
  const [fromSize, toSize] = paused ? sizes : sizes.reverse();
  if (onStage(from) && onStage(to) && !reducedMotion.matches) {
    $("word").style.visibility = $("cur").style.visibility = "hidden";
    await fly(from, to, fromSize, toSize);
    $("word").style.visibility = $("cur").style.visibility = "";
  }
  busy = false;
}

function fly(from, to, fromSize, toSize) {
  const clone = document.createElement("div");
  clone.className = "flying";
  clone.textContent = book.words[pos];
  clone.style.cssText = `left: ${from.left}px; top: ${from.top}px; font-size: ${fromSize}px`;
  document.body.append(clone);
  const end = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${toSize / fromSize})`;
  const animation = clone.animate([{ transform: "none" }, { transform: end }], {
    duration: 450,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  });
  return animation.finished.then(() => clone.remove());
}

// Rectángulo de la palabra en el lector, desde su primera letra.
function readerWordRect() {
  const left = $("left").getBoundingClientRect();
  const pivot = $("pivot").getBoundingClientRect();
  const x = left.width ? left.left : pivot.left;
  return new DOMRect(x, pivot.top, pivot.right - x, pivot.height);
}

// ¿Está el rectángulo dentro del área visible del lector? (si no, no se anima)
function onStage(rect) {
  const stage = $("stage").getBoundingClientRect();
  return rect.width > 0 && rect.top >= stage.top && rect.bottom <= stage.bottom;
}

const fontSize = (el) => parseFloat(getComputedStyle(el).fontSize);

// El sistema pide menos movimiento: sin vuelo de la palabra (y sin parpadeo, ver style.css).
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// ── Ajustes (se cambian desde el menú Ver) ──

// [id, nombre en el menú, tipo de letra propio del tema (opcional; ver FONTS)]
const THEMES = [
  ["tufte", "Tufte claro", "etbook"],
  ["tufte-dark", "Tufte oscuro", "etbook"],
  ["solarized-light", "Solarized claro"],
  ["solarized-dark", "Solarized oscuro"],
  ["latte", "Catppuccin Latte"],
  ["mocha", "Catppuccin Mocha"],
  ["gruvbox", "Gruvbox"],
  ["nord-light", "Nord claro"],
  ["nord", "Nord oscuro"],
  ["dracula", "Dracula"],
  ["typewriter-light", "Typewriter claro", "quattro"],
  ["typewriter-dark", "Typewriter oscuro", "quattro"],
];

// Ajustes de sí/no: nombre en el menú, valor por defecto, atajo y qué hacer al cambiarlos.
const toggles = {
  sidebar: { label: "Índice", on: true, accelerator: "Alt+CmdOrCtrl+S",
             apply: (on) => document.body.classList.toggle("nosidebar", !on) },
  chart:   { label: "Tiempo por capítulo", on: false,
             apply: (on) => document.body.classList.toggle("chart", on) },
  context: { label: "Palabras vecinas", on: false,
             apply: (on) => document.body.classList.toggle("context", on) },
  cover:   { label: "Portada en el índice", on: true,
             apply: (on) => document.body.classList.toggle("nocover", !on) },
  natural: { label: "Ritmo natural", on: true,
             apply: (on) => { natural = on; if (book) show(); } },
};

function isOn(key) {
  const saved = localStorage.getItem(key);
  return saved === null ? toggles[key].on : saved === "1";
}

function setToggle(key, on) {
  localStorage.setItem(key, on ? "1" : "");
  toggles[key].apply(on);
  buildMenu();
}

// Tamaño de letra, en % del tamaño base (16px). Como todo el CSS usa rem, la interfaz
// entera escala junta: índice, palabra, texto de la pausa y controles.
const FONT_SCALES = [80, 90, 100, 110, 120, 135, 150, 175];

function fontScale() {
  const saved = Number(localStorage.getItem("fontScale"));
  return FONT_SCALES.includes(saved) ? saved : 100;
}

// El siguiente tamaño de la lista: más grande (1), más pequeño (-1) o el normal (0).
function nextFontScale(current, direction) {
  if (direction === 0) return 100;
  const i = FONT_SCALES.indexOf(current);
  return FONT_SCALES[Math.max(0, Math.min(FONT_SCALES.length - 1, i + direction))];
}

function changeFontSize(direction) {
  const scale = nextFontScale(fontScale(), direction);
  localStorage.setItem("fontScale", scale);
  document.documentElement.style.fontSize = scale + "%";
  if (book && !timer && !busy) scrollToWord(false); // que la palabra actual siga a la vista
  buildMenu();
}

// Tipos de letra: [id, nombre en el menú, grupo]. Las familias están en style.css (--font-text).
// "serif", "sans" y "quattro" conservan su id de antes para no perder lo ya elegido.
const FONTS = [
  ["serif", "Iowan Old Style", "Con serifa"],
  ["newyork", "New York", "Con serifa"],
  ["charter", "Charter", "Con serifa"],
  ["etbook", "ET Book", "Con serifa"],
  ["sans", "San Francisco", "Sin serifa"],
  ["atkinson", "Atkinson Hyperlegible", "Sin serifa"],
  ["quattro", "iA Writer Quattro", "Sin serifa"],
];

// "auto" (según el tema) o el id de una fuente elegida a propósito.
function fontMode() {
  const saved = localStorage.getItem("font");
  return FONTS.some(([id]) => id === saved) ? saved : "auto";
}

// Fuente propia de un tema; Iowan Old Style ("serif") si no tiene.
function themeFont(theme = localStorage.getItem("theme") || "tufte") {
  return THEMES.find(([id]) => id === theme)?.[2] || "serif";
}

// La fuente que se usa: la elegida o, en "auto", la del tema actual.
function currentFont() {
  return fontMode() === "auto" ? themeFont() : fontMode();
}

const fontName = (id) => FONTS.find(([f]) => f === id)[1];

// `name`: el id de una fuente, o "auto" para usar la del tema.
function setFont(name) {
  localStorage.setItem("font", name);
  applyFont();
  buildMenu();
}

function applyFont() {
  document.documentElement.dataset.font = currentFont();
  if (book && !timer && !busy) scrollToWord(false); // que la palabra actual siga a la vista
}

function setTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem("theme", name);
  applyFont(); // en "Según el tema", la letra cambia con el tema
  buildMenu();
}

function setWpm(value) {
  wpm = Math.max(100, Math.min(1000, value));
  $("wpm").value = wpm;
  $("wpmLabel").textContent = wpm + " p/min";
  $("wpm").setAttribute("aria-valuetext", wpm + " palabras por minuto");
  localStorage.setItem("wpm", wpm);
  if (book) {
    renderToc(); // los tiempos estimados dependen de la velocidad
    show();
  }
}

// Con ↑ ↓ o el menú: cambia la velocidad y la muestra un instante bajo la palabra.
let speedTimer = null;
function changeWpm(delta) {
  setWpm(wpm + delta);
  $("speed").textContent = wpm + " p/min";
  $("speed").classList.add("on");
  clearTimeout(speedTimer);
  speedTimer = setTimeout(() => $("speed").classList.remove("on"), 1000);
}

function toggleHelp(visible = $("help").hidden) {
  $("help").hidden = !visible;
}

// ── Avisos ──
// Una ficha centrada sobre los controles (p. ej. "Guardado en Libro.md"). Opciones:
//   error: true            "Error:" en el rojo del tema; se queda hasta cerrarlo
//   undo: función          botón Deshacer (también ⌘Z o U); el aviso dura 6 s
//   action: { label, run } otro botón, p. ej. el que arregla un error
//   duration: ms           cuánto se ve; 0 = hasta que otro aviso lo reemplace
// Devuelve un número para cerrar justo ese aviso con hideToast (si no lo reemplazó otro).
let toastUndo = null; // lo que deshace el aviso visible, si tiene Deshacer
function notify(text, { error = false, undo = null, action = null, duration = error ? 0 : undo ? 6000 : 3500 } = {}) {
  clearTimeout(notify.timer);
  const id = (notify.id = (notify.id || 0) + 1);
  const label = document.createElement("strong");
  label.textContent = "Error: ";
  $("toastText").setAttribute("aria-live", error ? "assertive" : "polite");
  $("toastText").replaceChildren(...(error ? [label] : []), text);
  $("toast").classList.toggle("error", error);
  toastUndo = undo;
  const button = undo ? { label: "Deshacer", run: undo } : action;
  $("toastAction").hidden = !button;
  if (button) {
    $("toastAction").textContent = button.label;
    $("toastAction").onclick = () => {
      hideToast();
      button.run();
    };
  }
  $("toastClose").hidden = !error;
  $("toast").classList.add("show");
  if (duration) notify.timer = setTimeout(() => hideToast(id), duration);
  return id;
}

// Primero se cierra el aviso: lo que se deshace puede mostrar el suyo ("Guardado en…").
function undoFromToast() {
  const undo = toastUndo;
  hideToast();
  undo();
}

function hideToast(id = notify.id) {
  if (id !== notify.id) return; // ya lo reemplazó otro aviso
  $("toast").classList.remove("show");
  toastUndo = null;
}

// Abriendo un libro, en la línea del capítulo: true = un tramo que la recorre sin parar,
// un número de 0 a 1 = esa parte (páginas leídas de un PDF), false = terminó.
function setLoading(state) {
  $("chapterBar").classList.toggle("loading", state === true);
  $("chapterFill").style.width = state === true ? "30%" : state === false ? "0" : state * 100 + "%";
}

// ── Controles y teclado ──

$("open").onclick = chooseBook;
$("play").onclick = toggle;
$("back").onclick = () => book && goTo(pos - 10);
$("fwd").onclick = () => book && goTo(pos + 10);
$("wpm").oninput = () => setWpm(Number($("wpm").value));
$("progress").oninput = () => book && goTo(Number($("progress").value));
$("helpButton").onclick = () => toggleHelp();
$("help").onclick = () => toggleHelp(false);
$("toastClose").onclick = () => hideToast();

document.addEventListener("keydown", (e) => {
  // Mientras se escribe una nota, el teclado no controla la lectura.
  if ($("noteDialog").open || e.target.matches("textarea, input[type=text]")) return;
  // ⌘+ ⌘− ⌘0: tamaño de letra. Están en el menú, pero aquí se reconocen por el carácter
  // (en un teclado en español "+" tiene tecla propia y "=" no coincide). Los demás ⌘ son del menú.
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === "z" && !e.shiftKey && toastUndo) {
      undoFromToast(); // deshace lo del aviso (p. ej. un subrayado eliminado); si no, es el Deshacer del menú
      return e.preventDefault();
    }
    const size = { "+": 1, "=": 1, "-": -1, "0": 0 }[e.key];
    if (size !== undefined) {
      changeFontSize(size);
      e.preventDefault();
    }
    return;
  }
  if (e.target.parentElement === $("toc") && tocKey(e)) return e.preventDefault();
  if (e.key === "?") toggleHelp();
  else if (e.key === "Escape") {
    toggleHelp(false);
    setHighlighting(false);
    hideToast();
  } else if (!book) return;
  else if (e.code === "Space") toggle();
  else if (e.key === "ArrowLeft") goTo(pos - 10);
  else if (e.key === "ArrowRight") goTo(pos + 10);
  else if (e.key === "ArrowUp") changeWpm(25);
  else if (e.key === "ArrowDown") changeWpm(-25);
  else if (e.key === "[") jumpChapter(-1);
  else if (e.key === "]") jumpChapter(1);
  else if (e.key === "s" || e.key === "S") highlightKey();
  else if ((e.key === "u" || e.key === "U") && toastUndo) undoFromToast();
  else return;
  e.preventDefault();
  // Con un botón enfocado, Espacio también lo pulsaría al soltar la tecla. Las flechas ya no
  // mueven los deslizadores por el preventDefault, así que el foco se queda donde estaba.
  if (e.code === "Space") document.activeElement.blur?.();
});

// ── Al iniciar (cuando ya cargaron todos los archivos .js): aplicar ajustes y reabrir el último libro ──

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.theme = localStorage.getItem("theme") || "tufte";
  document.documentElement.style.fontSize = fontScale() + "%";
  document.documentElement.dataset.font = currentFont();
  for (const key in toggles) toggles[key].apply(isOn(key));
  setWpm(wpm);
  buildMenu();
  const last = localStorage.getItem("last");
  if (last) openBook(last);
});
