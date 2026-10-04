// Pruebas de ui/notes.js e ui/import.js: Markdown para Obsidian e importación de Kindle y Kobo.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadUI, bookFrom } = require("./load-ui.js");

// Archivos de prueba: ui-tests/resources
const resource = (name) => fs.readFileSync(path.join(__dirname, "resources", name), "utf8");

// Recortes de un Kindle, en español e inglés: un subrayado editado (dos versiones), su nota,
// un marcador, otra frase en la misma posición y un título con "(Spanish Edition)".
const CLIPPINGS = resource("My Clippings.txt");

test("Kindle: ediciones, notas, marcadores y títulos", () => {
  const ui = loadUI();
  const clips = ui.get(`parseKindle(${JSON.stringify(CLIPPINGS)})`);
  assert.deepEqual(
    clips.map((c) => [c.title, c.author, c.text, c.note]),
    [
      ["Demian", "Hermann Hesse", "El pájaro rompe el cascarón. El huevo es el mundo.", "La frase central."], // queda la última versión, con su nota
      ["Demian", "Hermann Hesse", "Otra frase en la misma posición.", ""],                                     // otra frase: no se pierde
      ["Tender Is the Night", "Fitzgerald, F. Scott", "The night was soft.", "Beautiful."],                   // sin "(Spanish Edition)"
    ]
  );
});

test("Kindle: posiciones abreviadas", () => {
  const ui = loadUI();
  assert.deepEqual(ui.get('kindleLocation("- Your Highlight | Location 1203-05 | Added")'), [1203, 1205]);
  assert.deepEqual(ui.get('kindleLocation("- Tu nota | posición 1.205 | Añadido")'), [1205, 1205]);
  assert.deepEqual(ui.get('kindleLocation("- Tu marcador en la página 3")'), [0, 0]);
});

test("Kindle: se buscan los capítulos una vez por libro, en carpetas sin repetir", async () => {
  const ui = loadUI();
  const calls = [];
  ui.handle("find_chapters", ({ title, quotes, dirs }) => {
    calls.push({ title, dirs });
    return quotes.map((q, i) => `Capítulo ${i + 1}`);
  });
  ui.run(`clips = parseKindle(${JSON.stringify(CLIPPINGS)})`);
  await ui.run('addKindleChapters(clips, ["/Kindle/documents", "/Libros", "/Libros"])');
  assert.deepEqual(calls.map((c) => c.title), ["Demian", "Tender Is the Night"]);
  assert.deepEqual(calls[0].dirs, ["/Kindle/documents", "/Libros"]);
  assert.deepEqual(ui.get("clips.map((c) => c.chapter)"), ["Capítulo 1", "Capítulo 2", "Capítulo 1"]);
});

test("Markdown: secciones por origen, sin duplicar y conservando lo escrito a mano", async () => {
  const ui = loadUI();
  ui.run('notesDir = "/Vault"');
  const file = "/Vault/Demian.md";
  ui.files[file] = resource("Demian.md"); // nota existente: texto propio y una sección de FastRead vieja

  const kindle = [{ title: "Demian", author: "Hermann Hesse", chapter: "Capítulo 5", text: "El pájaro.\n\nEl huevo.", note: "Central." }];
  await ui.run(`importClips("Kindle", ${JSON.stringify(kindle)})`);
  await ui.run(`importClips("Kindle", ${JSON.stringify(kindle)})`); // reimportar
  await ui.run('writeSection({ title: "Demian" }, "FastRead", clipsMarkdown("FastRead", [{ text: "Cita nueva", note: "", chapter: "" }]))');

  const md = ui.files[file];
  assert.equal(md.split("## Kindle").length, 2, "una sola sección de Kindle");
  assert.equal(md.split("## FastRead").length, 2, "una sola sección de FastRead");
  assert.ok(md.includes("Cita nueva") && !md.includes("Cita vieja"));
  assert.ok(md.includes("Mis ideas ANTES") && md.includes("Mis ideas DESPUÉS"));
  assert.ok(md.includes("### Capítulo 5\n\n> El pájaro.\n>\n> El huevo.\n\nCentral."));
  assert.ok(!md.includes("^"), "sin identificadores de bloque");
});

test("Markdown: un archivo nuevo empieza con sus propiedades", async () => {
  const ui = loadUI();
  ui.run('notesDir = "/Vault"');
  await ui.run('writeSection({ title: "Rayuela: \\"edición\\" [RAE]", author: "Julio Cortázar", source: "Kobo" }, "Kobo", "## Kobo")');
  const md = ui.files["/Vault/Rayuela edición RAE.md"]; // sin caracteres que Obsidian no admite
  assert.ok(md.startsWith('---\ntitle: "Rayuela: \\"edición\\" [RAE]"\nauthor: "Julio Cortázar"\nsource: "Kobo"\ntags: [libro]\n---\n'));
});

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
});
