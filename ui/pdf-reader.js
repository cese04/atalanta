// Lectura de PDF con pdf.js (ui/vendor/pdfjs, licencia Apache 2.0). Convierte el PDF en la
// misma estructura que los EPUB y MOBI que lee Rust (ver book.rs): palabras, párrafos, tipo de
// cada párrafo e índice. El resto de FastRead no distingue de dónde vino el libro.
//
// Un PDF solo dice qué texto va en qué posición de cada página, así que hay que reconstruir:
//   1. renglones (pdfLines): juntar los trozos de texto que comparten altura;
//   2. quitar encabezados, pies y números de página (stripRunningLines) y las notas al pie
//      (stripFootnotes), que interrumpirían la lectura palabra por palabra;
//   3. párrafos (buildPdfBook): unir renglones, cortar por espacio, sangría o renglón corto,
//      unir palabras partidas con guion y detectar títulos por su tamaño de letra;
//   4. índice: los marcadores del PDF o, si no tiene, los títulos detectados.

// ── Con pdf.js ──

// Abre un PDF y devuelve el libro. `progress(página, total)` informa del avance.
async function openPdf(path, progress) {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.mjs";
  const data = new Uint8Array(await invoke("read_bytes", { path }));
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progress?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    pages.push(pdfLines((await page.getTextContent()).items));
    page.cleanup();
  }
  const outline = await pdfOutline(pdf);
  const info = (await pdf.getMetadata().catch(() => null))?.info || {};
  await task.destroy(); // libera la memoria del PDF
  const title = String(info.Title || "").trim() || path.split(/[\\/]/).pop().replace(/\.pdf$/i, "");
  const book = buildPdfBook(pages, outline, title, String(info.Author || "").trim());
  if (!book.words.length) throw "el PDF no tiene texto (¿está escaneado?)";
  return book;
}

// Marcadores del PDF -> [{ title, level, page }] (página empezando en 0).
async function pdfOutline(pdf) {
  const out = [];
  const walk = async (items, level) => {
    for (const item of items || []) {
      try {
        const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        const page = typeof dest?.[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
        out.push({ title: item.title.replace(/\s+/g, " ").trim(), level, page });
      } catch {
        // marcador sin destino válido: se ignora
      }
      await walk(item.items, level + 1);
    }
  };
  await walk(await pdf.getOutline(), 0);
  return out;
}

// Trozos de texto de una página (pdf.js) -> renglones { text, x, y, size, right }.
// `y` crece hacia arriba (coordenadas de PDF); `size` es el tamaño de letra.
function pdfLines(items) {
  const lines = [];
  let line = null;
  for (const item of items) {
    if (!("str" in item)) continue;
    const [, , c, d, x, y] = item.transform;
    const size = Math.hypot(c, d) || item.height;
    if (!line || Math.abs(y - line.y) > size * 0.5) {
      line = { text: "", x, y, size, right: x };
      lines.push(line);
    }
    line.text += item.str;
    line.x = Math.min(line.x, x);
    line.size = Math.max(line.size, size);
    line.right = Math.max(line.right, x + item.width);
    if (item.hasEOL) line = null;
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
}

// ── Reconstrucción del libro (sin pdf.js: se puede probar con datos de ejemplo) ──

// Valor en la posición `q` (0 a 1) de una lista ordenada: 0.5 es la mediana.
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : 0;
};
const median = (values) => quantile(values, 0.5);

// Quita encabezados, pies y números de página: de los dos primeros y dos últimos renglones de
// cada página, los que son solo un número o se repiten (sin contar los números) en 3 páginas o
// más. Basta con 3 porque el encabezado suele cambiar con cada capítulo ("224 Capítulo 7").
function stripRunningLines(pages) {
  const key = (text) => text.toLowerCase().replace(/\d+/g, "#");
  const edges = (lines) => new Set([...lines.slice(0, 2), ...lines.slice(-2)]);
  const counts = new Map();
  for (const lines of pages) {
    for (const k of new Set([...edges(lines)].map((l) => key(l.text)))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return pages.map((lines) => {
    const edge = edges(lines);
    return lines.filter((l) => {
      if (!edge.has(l)) return true;
      if (/^(\d+|[ivxlcdm]{1,6})$/i.test(l.text)) return false; // número de página
      return counts.get(key(l.text)) < 3;
    });
  });
}

// Quita las notas al pie: los renglones de letra más pequeña que el texto que quedan al final
// de la página, después de su último renglón de tamaño normal.
function stripFootnotes(pages, body) {
  return pages.map((lines) => {
    let last = lines.length - 1;
    while (last >= 0 && lines[last].size < body * 0.92) last--;
    return lines.slice(0, last + 1);
  });
}

// Renglones de todas las páginas -> libro { title, author, words, paragraphs, kinds, toc… }.
// `outline`: marcadores del PDF [{ title, level, page }].
function buildPdfBook(pages, outline, title, author) {
  pages = stripRunningLines(pages);
  const body = median(pages.flat().map((l) => l.size)) || 1; // tamaño de letra del texto
  pages = stripFootnotes(pages, body);
  const all = pages.flat();
  const left = median(all.map((l) => Math.round(l.x)));      // margen izquierdo habitual
  const right = quantile(all.map((l) => l.right), 0.8);     // donde acaba un renglón completo (los diálogos o versos cortos no cuentan)
  const gaps = pages.flatMap((lines) => lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0));
  const gap = median(gaps) || body * 1.2;                    // espacio habitual entre renglones

  const paragraphs = []; // { kind, text }
  const pageStart = [];  // por página: { paragraph, wordsBefore } de su primer renglón
  const kindOf = (line) => (line.size >= body * 1.6 ? "h1" : line.size >= body * 1.3 ? "h2" : "");
  let prev = null;
  pages.forEach((lines, p) => {
    lines.forEach((line, i) => {
      const kind = line.text.length < 120 ? kindOf(line) : "";
      const current = paragraphs.at(-1);
      const newParagraph =
        !current ||
        kind !== current.kind ||                                          // empieza o termina un título
        (i > 0 && lines[i - 1].y - line.y > gap * 1.6) ||                 // espacio vertical extra
        (!kind && line.x > left + body) ||                                // sangría de primera línea
        (prev && prev.right < right - body * 3 && /[.!?:…"»”)]$/.test(prev.text)); // renglón anterior corto que cierra frase
      if (newParagraph) {
        paragraphs.push({ kind, text: line.text });
      } else if (/\p{L}-$/u.test(current.text) && /^\p{Ll}/u.test(line.text)) {
        current.text = current.text.slice(0, -1) + line.text;             // "pala-" + "bra"
      } else {
        current.text += " " + line.text;
      }
      if (!pageStart[p]) {
        const last = paragraphs.at(-1);
        pageStart[p] = { paragraph: paragraphs.length - 1, wordsBefore: newParagraph ? 0 : last.text.split(/\s+/).length - line.text.split(/\s+/).length };
      }
      prev = line;
    });
  });

  // Palabras y párrafos con la misma forma que los libros de Rust.
  const words = [];
  const starts = [];
  for (const p of paragraphs) {
    starts.push(words.length);
    words.push(...p.text.split(/\s+/).filter(Boolean));
  }
  // Primera palabra de cada página (las páginas sin texto toman la de la siguiente).
  const pageWord = [];
  for (let p = pages.length - 1, next = words.length; p >= 0; p--) {
    if (pageStart[p]) next = starts[pageStart[p].paragraph] + pageStart[p].wordsBefore;
    pageWord[p] = Math.min(next, Math.max(0, words.length - 1));
  }

  let toc = outline
    .filter((o) => o.title && o.page >= 0 && o.page < pages.length)
    .map((o) => ({ title: o.title, level: o.level, word: pageWord[o.page] }));
  if (!toc.length) {
    toc = paragraphs
      .map((p, i) => ({ title: p.text, level: p.kind === "h1" ? 0 : 1, word: starts[i], kind: p.kind }))
      .filter((c) => c.kind)
      .map(({ kind, ...c }) => c);
  }

  return {
    title,
    author,
    description: "",
    words,
    paragraphs: starts,
    kinds: paragraphs.map((p) => p.kind),
    scene_breaks: [],
    styles: [],
    toc,
  };
}
