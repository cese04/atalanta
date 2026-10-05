// FastRead: muestra un libro palabra por palabra. Al pausar, la palabra "vuela" a su
// lugar en el texto completo, que se puede recorrer y donde un clic elige desde dónde seguir.
//
// Archivos de la interfaz:
//   app.js     lectura, vistas, índice, ajustes y teclado (este archivo)
//   rhythm.js  cuánto dura cada palabra y qué es diálogo
//   notes.js   subrayados y notas para Obsidian
//   menu.js    menú principal y libros recientes
//
// Lo guardado entre sesiones vive en localStorage:
//   "wpm"         -> velocidad (palabras por minuto)
//   "theme"       -> tema de colores
//   "sidebar", "chart", "context", "natural" -> "1" / "" (ver `toggles`)
//   "notesDir"    -> carpeta de notas
//   "recent"      -> libros recientes
//   "last"        -> ruta del último libro abierto
//   "pos:<ruta>"  -> palabra donde te quedaste en ese libro

const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const $ = (id) => document.getElementById(id);

let book = null;   // { title, author, words: [...], paragraphs: [...], toc: [{ title, level, word }] }
let path = null;   // ruta del libro abierto
let pos = 0;       // número de la palabra actual
let timer = null;  // distinto de null mientras se está leyendo
let busy = false;  // true durante la animación entre vistas
let chapterStarts = new Map(); // número de palabra -> capítulo que empieza ahí
let rampLeft = 0;  // palabras que faltan del arranque gradual
let natural = true; // "Ritmo natural" (ver rhythm.js)
let speech = new Uint8Array(0); // 1 = la palabra es diálogo (ver findSpeech en rhythm.js)
let wpm = Number(localStorage.getItem("wpm")) || 300;
let lengths = [];  // palabras de cada capítulo (mismo orden que book.toc)

// ── Abrir libro ──

async function chooseBook() {
  const p = await open({ filters: [{ name: "Libros", extensions: ["epub", "mobi"] }] });
  if (p) openBook(p);
}

async function openBook(p) {
  stopTimer();
  setHighlighting(false);
  $("msg").textContent = "Cargando…";
  try {
    book = await invoke("open_book", { path: p });
  } catch (e) {
    $("msg").textContent = "No se pudo abrir el libro: " + e;
    setPaused(false); // muestra el mensaje
    localStorage.removeItem("last");
    removeRecent(p);
    return;
  }
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
  speech = findSpeech();
  await loadHighlights();
  renderToc();
  renderPage();
  setPaused(true); // un libro recién abierto empieza en pausa, mostrando el texto
  goTo(Number(localStorage.getItem("pos:" + p)) || 0);
  addRecent();
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
    li.onclick = () => goTo(chapter.word);
    $("toc").append(li);
  });
  $("info").textContent = `${formatMinutes(book.words.length / wpm)} de lectura a ${wpm} palabras/min`;
  currentLi = null;
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
  const starts = new Set(book.toc.map((ch) => ch.word));
  const fragment = document.createDocumentFragment();
  book.paragraphs.forEach((start, i) => {
    const p = document.createElement("p");
    p.append(...paragraphNodes(i));
    if (starts.has(start)) p.className = "chapter";
    fragment.append(p);
  });
  $("page").replaceChildren(fragment);
  marked = pos < book.words.length ? paragraphOf(pos) : -1;
}

// Contenido de un párrafo: texto normal, subrayados (<span class="hl">)
// y la palabra actual (<span id="cur">).
function paragraphNodes(i) {
  const start = book.paragraphs[i];
  const end = paragraphEnd(i);
  const marks = highlights.filter((h) => h.start < end && h.end >= start);
  if (!marks.length && (pos < start || pos >= end)) return [paragraphText(i)];

  // Agrupa palabras seguidas con el mismo estilo en un solo nodo.
  const nodes = [];
  let words = [], key = null, mark = null, current = false;
  const flush = () => {
    if (!words.length) return;
    if (nodes.length) nodes.push(" ");
    const text = words.join(" ");
    if (!mark && !current) {
      nodes.push(text);
    } else {
      const span = document.createElement("span");
      span.textContent = text;
      if (mark) {
        span.className = "hl";
        span.dataset.id = mark.id;
      }
      if (current) span.id = "cur";
      nodes.push(span);
    }
    words = [];
  };
  for (let w = start; w < end; w++) {
    const m = marks.find((h) => w >= h.start && w <= h.end) || null;
    const k = (m ? m.id : "") + (w === pos ? "*" : "");
    if (k !== key) {
      flush();
      key = k;
      mark = m;
      current = w === pos;
    }
    words.push(book.words[w]);
  }
  flush();
  return nodes;
}

// Vuelve a dibujar los párrafos entre dos palabras (p. ej. tras cambiar un subrayado).
function refreshParagraphs(from, to) {
  for (let i = paragraphOf(from); i <= paragraphOf(to); i++) {
    $("page").children[i].replaceChildren(...paragraphNodes(i));
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
  if (marked >= 0 && marked !== i) $("page").children[marked].replaceChildren(...paragraphNodes(marked));
  $("page").children[i].replaceChildren(...paragraphNodes(i));
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
  const p = element?.closest("#page > p");
  if (!p) return null;
  const range = document.createRange();
  range.setStart(p, 0);
  range.setEnd(node, offset);
  return { i: Array.prototype.indexOf.call($("page").children, p), before: range.toString(), length: p.textContent.length };
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
  $("word").classList.toggle("speech", natural && speech[pos] === 1); // diálogo en cursiva
  $("word").classList.toggle("marked", highlights.some((h) => pos >= h.start && pos <= h.end)); // subrayada

  // Progreso del libro y del capítulo actual
  const total = book.words.length;
  $("progress").value = pos;
  $("bookStatus").textContent = `Libro ${percent(pos, total)} · quedan ${formatMinutes((total - pos) / wpm)}`;
  const c = chapterAt(pos);
  $("head").textContent = c < 0 ? "" : book.toc[c].title;
  const chapterLeft = c < 0 ? 0 : book.toc[c].word + lengths[c] - pos;
  $("chapterStatus").textContent =
    c < 0 ? "" : `Capítulo ${percent(pos - book.toc[c].word, lengths[c])} · quedan ${formatMinutes(chapterLeft / wpm)}`;

  highlightChapter(c);
  fillBars();
  localStorage.setItem("pos:" + path, pos);
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

// Marca en el índice el capítulo actual.
let currentLi = null;
function highlightChapter(index) {
  const li = $("toc").children[index] || null;
  if (li === currentLi) return;
  currentLi?.classList.remove("current");
  li?.classList.add("current");
  li?.scrollIntoView({ block: "nearest" });
  currentLi = li;
}

// ── Leer / pausar ──

async function play() {
  if (!book || timer || busy) return;
  setHighlighting(false);
  $("play").textContent = "Pausa";
  await switchView(false, $("cur").getBoundingClientRect(), readerWordRect());
  rampLeft = RAMP_WORDS; // al retomar también se arranca de forma gradual
  tick();
}

function pause() {
  if (!timer) return;
  stopTimer();
  show(); // por si se pausó durante un cambio de capítulo
  const from = readerWordRect();
  markWord();
  scrollToWord(true);
  switchView(true, from, $("cur").getBoundingClientRect());
  buildMenu(); // actualiza el % leído en "Abrir reciente"
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
    $("card").textContent = chapter.title;
    $("reader").classList.replace("blank", "titled");
    timer = setTimeout(() => {
      $("reader").classList.remove("titled");
      pos = skipTitle(pos, chapter.title);
      rampLeft = RAMP_WORDS;
      tick();
    }, CARD_MS);
  }, BREATH_MS);
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
  const sizes = [fontSize($("word")), fontSize($("page"))];
  const [fromSize, toSize] = paused ? sizes : sizes.reverse();
  if (onStage(from) && onStage(to)) {
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

// ── Ajustes (se cambian desde el menú Ver) ──

const THEMES = [
  ["tufte", "Tufte"],
  ["solarized-light", "Solarized claro"],
  ["solarized-dark", "Solarized oscuro"],
  ["latte", "Catppuccin Latte"],
  ["mocha", "Catppuccin Mocha"],
  ["gruvbox", "Gruvbox"],
  ["nord", "Nord"],
  ["dracula", "Dracula"],
];

// Ajustes de sí/no: nombre en el menú, valor por defecto, atajo y qué hacer al cambiarlos.
const toggles = {
  sidebar: { label: "Índice", on: true, accelerator: "Alt+CmdOrCtrl+S",
             apply: (on) => document.body.classList.toggle("nosidebar", !on) },
  chart:   { label: "Tiempo por capítulo", on: false,
             apply: (on) => document.body.classList.toggle("chart", on) },
  context: { label: "Palabras vecinas", on: false,
             apply: (on) => document.body.classList.toggle("context", on) },
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

function setTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem("theme", name);
  buildMenu();
}

function setWpm(value) {
  wpm = Math.max(100, Math.min(1000, value));
  $("wpm").value = wpm;
  $("wpmLabel").textContent = wpm + " p/min";
  localStorage.setItem("wpm", wpm);
  if (book) {
    renderToc(); // los tiempos estimados dependen de la velocidad
    show();
  }
}

function toggleHelp(visible = $("help").hidden) {
  $("help").hidden = !visible;
}

// Mensaje breve abajo a la derecha (p. ej. "Guardado en Libro.md").
function notify(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $("toast").classList.remove("show"), 3500);
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

document.addEventListener("keydown", (e) => {
  // Mientras se escribe una nota, o con ⌘/Ctrl (atajos del menú), el teclado no controla la lectura.
  if ($("noteDialog").open || e.target.matches("textarea, input[type=text]") || e.metaKey || e.ctrlKey) return;
  if (e.key === "?") toggleHelp();
  else if (e.key === "Escape") {
    toggleHelp(false);
    setHighlighting(false);
  } else if (!book) return;
  else if (e.code === "Space") toggle();
  else if (e.key === "ArrowLeft") goTo(pos - 10);
  else if (e.key === "ArrowRight") goTo(pos + 10);
  else if (e.key === "ArrowUp") setWpm(wpm + 25);
  else if (e.key === "ArrowDown") setWpm(wpm - 25);
  else if (e.key === "[") jumpChapter(-1);
  else if (e.key === "]") jumpChapter(1);
  else if (e.key === "s" || e.key === "S") highlightKey();
  else return;
  e.preventDefault();
  document.activeElement.blur?.(); // evita que un control enfocado también reaccione
});

// ── Al iniciar (cuando ya cargaron todos los archivos .js): aplicar ajustes y reabrir el último libro ──

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.theme = localStorage.getItem("theme") || "tufte";
  for (const key in toggles) toggles[key].apply(isOn(key));
  setWpm(wpm);
  buildMenu();
  const last = localStorage.getItem("last");
  if (last) openBook(last);
});
