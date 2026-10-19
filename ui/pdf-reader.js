// Lectura de PDF con pdf.js (ui/vendor/pdfjs, licencia Apache 2.0). Aquí se sacan del PDF los
// renglones de cada página (pdfLines), los marcadores y la portada; reconstruir el libro a
// partir de los renglones (párrafos, encabezados, notas al pie, títulos, índice) lo hace Rust
// (core/src/pdf.rs), que devuelve la misma estructura que un EPUB.

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
  const cover = await pdfCover(pdf);
  const info = (await pdf.getMetadata().catch(() => null))?.info || {};
  await task.destroy(); // libera la memoria del PDF
  const title = String(info.Title || "").trim() || path.split(/[\\/]/).pop().replace(/\.pdf$/i, "");
  const book = await invoke("pdf_book", { pages, outline, title, author: String(info.Author || "").trim() });
  if (!book.words.length) throw "el PDF no tiene texto (¿está escaneado?)";
  book.coverBlob = cover; // la portada de un PDF es su primera página (ver loadCover en app.js)
  return book;
}

// La primera página dibujada como imagen (JPEG), o null si no se puede.
async function pdfCover(pdf) {
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: COVER_HEIGHT / page.getViewport({ scale: 1 }).height });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } catch {
    return null;
  }
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
