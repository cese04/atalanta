// Pruebas de ui/pdf-reader.js: juntar los trozos de texto de pdf.js en renglones.
// La reconstrucción del libro (párrafos, encabezados, índice) se prueba en core/tests/pdf.rs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadUI } = require("./load-ui.js");

test("PDF: los trozos de texto de una página se agrupan en renglones", () => {
  const ui = loadUI();
  const item = (str, x, y, eol = false) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, hasEOL: eol });
  const items = [item("Hola ", 72, 700), item("mundo", 97, 700, true), item("Segundo", 72, 688), { type: "beginMarkedContent" }];
  const lines = ui.get(`pdfLines(${JSON.stringify(items)})`);
  assert.deepEqual(lines.map((l) => [l.text, l.x, l.y, l.size]), [["Hola mundo", 72, 700, 10], ["Segundo", 72, 688, 10]]);
});
