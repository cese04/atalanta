// Pruebas de ui/notes.js y ui/menu.js: lo que queda en la interfaz de las notas (texto de un
// subrayado, colores, portada, qué propiedades se piden a Rust) y los libros recientes.
// El Markdown de las notas y las importaciones de Kindle y Kobo se prueban en Rust
// (core/tests/notes.rs, kindle.rs, kobo.rs).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadUI, bookFrom } = require("./load-ui.js");

// Simula el comando notes_properties y guarda lo que la interfaz le pide.
function recordProperties(ui) {
  const calls = [];
  ui.handle("notes_properties", (args) => calls.push(args));
  return calls;
}

test("texto de un subrayado que abarca dos párrafos", () => {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom("Uno dos tres.|Cuatro cinco."))}`);
  assert.equal(ui.run("textOf(1, 3)"), "dos tres.\n\nCuatro");
});

test("libros recientes y rutas cortas", () => {
  const ui = loadUI();
  ui.storage.set("pos:/a.epub", "50");
  assert.equal(ui.run('recentLabel({ path: "/a.epub", title: "Demian", words: 200 })'), "Demian — 25 %");
  assert.equal(ui.run('shortPath("/Users/ana/Notas")'), "~/Notas");
  assert.equal(ui.run('shortPath("/Users/ana/Obsidian/Vault/Libros")'), "…/Vault/Libros");
  assert.equal(ui.run('shortPath("/home/ana/Notas")'), "~/Notas");
  assert.equal(ui.run(String.raw`shortPath("C:\\Users\\ana\\Notas")`), "~\\Notas");
  assert.equal(ui.run(String.raw`shortPath("C:\\Users\\ana\\Obsidian\\Vault\\Libros")`), "…\\Vault\\Libros");
});

// Las pruebas corren como fuera de macOS: los atajos se escriben con Ctrl, Alt y Mayús.
test("atajos con Ctrl, Alt y Mayús fuera de macOS", () => {
  const ui = loadUI();
  const keys = (text) => ui.run(`localizeKeys(${JSON.stringify(text)})`);
  assert.equal(keys("⌘O"), "Ctrl+O");
  assert.equal(keys("⌥⌘S"), "Ctrl+Alt+S");
  assert.equal(keys("⌘"), "Ctrl");
  assert.equal(keys("⌘ Enter"), "Ctrl+Enter");
  assert.equal(keys("⌘+"), "Ctrl++");
  assert.equal(keys("⇧U"), "Mayús+U");
  assert.equal(keys("Espacio"), "Espacio");
});

test("color de marcatextos: amarillo si falta o no es válido", () => {
  const ui = loadUI();
  assert.equal(ui.run('markColor({ color: "azul" })'), "azul");
  assert.equal(ui.run("markColor({})"), "amarillo"); // subrayados de antes, sin color
  assert.equal(ui.run('markColor({ color: "morado" })'), "amarillo");
});

test("propiedades de lectura: progreso y velocidad, inicio una vez y fin al terminar", async () => {
  const ui = loadUI();
  const calls = recordProperties(ui);
  ui.run(`notesDir = "/Vault"; path = "/Libros/Demian.epub"; wpm = 300`);
  ui.run(`book = ${JSON.stringify(bookFrom("Uno dos tres cuatro cinco", { title: "Demian", author: "Hermann Hesse" }))}`);
  const today = ui.run("today()");

  ui.run("pos = 2");
  await ui.run("saveReading()");
  ui.run("pos = 4");
  await ui.run("saveReading()");

  assert.deepEqual(calls[0], {
    dir: "/Vault",
    info: { title: "Demian", author: "Hermann Hesse", source: "Demian.epub" },
    set: [["progress", "50"], ["wpm", "300"]],
    keep: [["started", today]],
  });
  assert.deepEqual(calls[1].keep, [["started", today], ["finished", today]]); // llegó al final
});

test("propiedades de lectura: sin carpeta de notas no se pide nada", async () => {
  const ui = loadUI();
  const calls = recordProperties(ui);
  ui.run(`notesDir = ""; book = ${JSON.stringify(bookFrom("Uno dos"))}`);
  await ui.run("saveReading()");
  assert.equal(calls.length, 0);
});

test("portada: tipo de imagen según sus primeros bytes", () => {
  const ui = loadUI();
  assert.equal(ui.run("imageType([0xff, 0xd8, 0xff])"), "image/jpeg");
  assert.equal(ui.run("imageType([0x89, 0x50, 0x4e, 0x47])"), "image/png");
  assert.equal(ui.run("imageType([0x47, 0x49, 0x46])"), "image/gif");
  assert.equal(ui.run("imageType([1, 2, 3])"), "");
});

test("portada: se guarda una vez en portadas/ y la nota la enlaza con `cover`", async () => {
  const ui = loadUI();
  const calls = recordProperties(ui);
  ui.run(`notesDir = "/Vault"; path = "/Libros/Demian.epub"; wpm = 300; pos = 0`);
  ui.run(`book = ${JSON.stringify(bookFrom("Uno dos tres", { title: "Demian" }))}`);
  const blob = "({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })";
  await ui.run(`saveCover(${blob})`);
  assert.deepEqual(ui.files["/Vault/portadas/Demian.jpg"], [1, 2, 3]);
  assert.deepEqual(calls.at(-1).set.at(-1), ["cover", '"[[Demian.jpg]]"']);

  ui.files["/Vault/portadas/Demian.jpg"] = [9]; // ya existe (p. ej. la cambiaste a mano): no se reescribe
  await ui.run(`saveCover(${blob})`);
  assert.deepEqual(ui.files["/Vault/portadas/Demian.jpg"], [9]);
});

test("portada: sin carpeta de notas no se guarda nada", async () => {
  const ui = loadUI();
  ui.run(`notesDir = ""; book = ${JSON.stringify(bookFrom("Uno", { title: "Demian" }))}`);
  await ui.run("saveCover({ arrayBuffer: async () => new ArrayBuffer(1) })");
  assert.deepEqual(Object.keys(ui.files), []);
});

test("deshacer al eliminar: el subrayado vuelve en su orden y se guarda", async () => {
  const ui = loadUI();
  const saved = [];
  ui.handle("notes_section", ({ clips }) => saved.push(clips.map((c) => c.id)));
  ui.handle("notes_summary", () => {});
  ui.run(`book = ${JSON.stringify({ ...bookFrom("a b c d e f"), note_name: "Libro" })}`);
  ui.run(`notesDir = "/Vault"; path = "/Libro.epub"; renderPage = () => {}; refreshParagraphs = () => {}`);
  ui.run(`gone = { id: "h2", start: 2, end: 3 };
          highlights = [{ id: "h1", start: 0, end: 0 }, { id: "h3", start: 4, end: 5 }]`);
  await ui.run(`restoreHighlight(gone, "/Libro.epub")`);
  assert.deepEqual(ui.get("highlights.map((h) => h.id)"), ["h1", "h2", "h3"]);
  assert.deepEqual(saved, [["h1", "h2", "h3"]]);
  await ui.run(`restoreHighlight(gone, "/Libro.epub")`); // ya está: no se duplica
  await ui.run(`restoreHighlight({ id: "h9", start: 1, end: 1 }, "/Otro.epub")`); // otro libro: nada
  assert.equal(ui.run("highlights.length"), 3);
  assert.equal(saved.length, 1);
});

test("avisos: ⌘Z solo deshace mientras se ve su aviso", () => {
  const ui = loadUI();
  const first = ui.run(`notify("Subrayado eliminado", { undo: () => {} })`);
  assert.equal(ui.run("typeof toastUndo"), "function");
  ui.run(`notify("Guardado en Libro.md")`); // otro aviso lo reemplaza: ya no hay qué deshacer
  assert.equal(ui.run("toastUndo"), null);
  ui.run(`notify("Subrayado eliminado", { undo: () => {} })`);
  ui.run(`hideToast(${first})`); // cerrar un aviso viejo no cierra el actual
  assert.equal(ui.run("typeof toastUndo"), "function");
  ui.run("hideToast()");
  assert.equal(ui.run("toastUndo"), null);
});
