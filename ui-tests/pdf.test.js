// Pruebas de ui/pdf-reader.js: reconstruir un libro a partir de los renglones de un PDF.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadUI } = require("./load-ui.js");

const SAMPLE = fs.readFileSync(path.join(__dirname, "resources", "pdf-paginas.json"), "utf8");

// Texto de cada párrafo del libro, con su tipo.
function paragraphs(book) {
  return book.paragraphs.map((start, i) => {
    const end = book.paragraphs[i + 1] ?? book.words.length;
    return [book.kinds[i], book.words.slice(start, end).join(" ")];
  });
}

test("PDF: párrafos, títulos, palabras partidas, sin encabezados, números de página ni notas", () => {
  const ui = loadUI();
  const book = ui.get(`(() => { const s = ${SAMPLE}; return buildPdfBook(s.paginas, s.marcadores, "Mi libro", "Ana"); })()`);
  assert.deepEqual(paragraphs(book), [
    ["h1", "Capítulo uno"],
    ["", "Era una vez un libro muy largo que seguía."],                       // "li-" + "bro"; sangría
    ["", "Otro párrafo que continúa en la página siguiente y aquí termina."], // sigue en la página 2
    ["", "Un párrafo tras un espacio y largo que ocupa dos renglones completos"],
    ["h1", "Capítulo dos"],
    ["", "Fin del libro."],
  ]); // sin "Mi libro" (encabezado), sin "1", "2", "3" (números de página) ni la nota al pie
  assert.equal(book.author, "Ana");
});

test("PDF: el índice sale de los marcadores, apuntando a la primera palabra de su página", () => {
  const ui = loadUI();
  const book = ui.get(`(() => { const s = ${SAMPLE}; return buildPdfBook(s.paginas, s.marcadores, "", ""); })()`);
  assert.deepEqual(book.toc, [
    { title: "Uno", level: 0, word: 0 },
    { title: "Dos", level: 0, word: book.words.indexOf("Capítulo", 1) },
  ]);
});

test("PDF: sin marcadores, el índice sale de los títulos detectados", () => {
  const ui = loadUI();
  const book = ui.get(`(() => { const s = ${SAMPLE}; return buildPdfBook(s.paginas, [], "", ""); })()`);
  assert.deepEqual(book.toc.map((c) => c.title), ["Capítulo uno", "Capítulo dos"]);
});

test("PDF: los trozos de texto de una página se agrupan en renglones", () => {
  const ui = loadUI();
  const item = (str, x, y, eol = false) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, hasEOL: eol });
  const items = [item("Hola ", 72, 700), item("mundo", 97, 700, true), item("Segundo", 72, 688), { type: "beginMarkedContent" }];
  const lines = ui.get(`pdfLines(${JSON.stringify(items)})`);
  assert.deepEqual(lines.map((l) => [l.text, l.x, l.y, l.size]), [["Hola mundo", 72, 700, 10], ["Segundo", 72, 688, 10]]);
});
