// Pruebas de ui/app.js: párrafos, capítulos, títulos repetidos y formatos de tiempo.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadUI, bookFrom } = require("./load-ui.js");

test("párrafo de una palabra", () => {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom("a b c|d e|f"))}`);
  assert.deepEqual([0, 2, 3, 4, 5].map((w) => ui.run(`paragraphOf(${w})`)), [0, 0, 1, 1, 2]);
  assert.deepEqual([0, 1, 3, 5].map((w) => ui.run(`isParagraphStart(${w})`)), [true, false, true, true]);
});

test("capítulo de una palabra y duración de cada capítulo", () => {
  const ui = loadUI();
  const toc = [
    { title: "Uno", level: 0, word: 0 },
    { title: "Uno.a", level: 1, word: 4 },
    { title: "Dos", level: 0, word: 8 },
  ];
  ui.run(`book = ${JSON.stringify(bookFrom("a b c d e f g h i j", { toc }))}`);
  assert.deepEqual([0, 3, 4, 9].map((w) => ui.run(`chapterAt(${w})`)), [0, 0, 1, 2]);
  assert.deepEqual(ui.get("chapterLengths()"), [8, 4, 2]); // "Uno" incluye a su subcapítulo
});

test("saltar el título repetido solo si coincide completo y es su propio párrafo", () => {
  const cases = [
    ["2. La Virgen de la tosquera", "2. La Virgen de la tosquera|Mi tía decía", "Mi"],
    ["I. EL CUERPO DE LOS CONDENADOS", "I|El cuerpo de los condenados|« El 2", "«"],
    ["Capítulo 2", "2|Hacía frío", "2"],                                  // no coincide: no salta
    ["Prólogo", "Prólogo de la edición española|Esta obra", "Prólogo"],   // no es su propio párrafo
  ];
  for (const [title, text, next] of cases) {
    const ui = loadUI();
    ui.run(`book = ${JSON.stringify(bookFrom(text))}`);
    assert.equal(ui.run(`book.words[skipTitle(0, ${JSON.stringify(title)})]`), next, title);
  }
});

test("formatos de tiempo y porcentaje", () => {
  const ui = loadUI();
  assert.equal(ui.run("formatMinutes(0.4)"), "<1 min");
  assert.equal(ui.run("formatMinutes(25)"), "25 min");
  assert.equal(ui.run("formatMinutes(135)"), "2 h 15");
  assert.equal(ui.run("percent(45, 100)"), "45 %");
  assert.equal(ui.run("percent(1, 0)"), "100 %");
});

test("ajustes de sí/no con valor por defecto", () => {
  const ui = loadUI();
  assert.equal(ui.run('isOn("natural")'), true); // activado por defecto
  assert.equal(ui.run('isOn("chart")'), false);
  ui.storage.set("natural", "");
  assert.equal(ui.run('isOn("natural")'), false);
});
