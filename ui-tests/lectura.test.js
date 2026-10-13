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

test("inicio de la frase: sin salir del párrafo y sin cortar en abreviaturas", () => {
  const ui = loadUI();
  //                                        0    1      2       3     4      5   6    7      8       9
  ui.run(`book = ${JSON.stringify(bookFrom("Llegó tarde. Vio al Sr. Pérez y sonrió.|Nueva idea aquí."))}`);
  const word = (p) => ui.run(`book.words[sentenceStart(${p})]`);
  assert.equal(word(1), "Llegó"); // primera frase del libro
  assert.equal(word(6), "Vio");   // "Sr." no termina la frase
  assert.equal(word(2), "Vio");   // ya en el inicio de la frase
  assert.equal(word(9), "Nueva"); // no salta al párrafo anterior
});

test("al reanudar: retrocede solo tras una pausa larga y si no se eligió otra palabra", () => {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom("Primera frase. Segunda frase con varias palabras más."))}`);
  assert.equal(ui.run("resumeFrom(6, 10000, false)"), 2); // pausa larga: inicio de "Segunda frase…"
  assert.equal(ui.run("resumeFrom(6, 1000, false)"), 6);  // pausa corta: sigue donde iba
  assert.equal(ui.run("resumeFrom(6, 10000, true)"), 6);  // eligió esa palabra: sigue ahí
});

test("al reanudar: no retrocede más de REWIND_MAX_WORDS en frases muy largas", () => {
  const ui = loadUI();
  const longSentence = Array.from({ length: 100 }, (_, i) => `palabra${i}`).join(" ");
  ui.run(`book = ${JSON.stringify(bookFrom(longSentence))}`);
  assert.equal(ui.run("resumeFrom(80, 10000, false)"), 80 - ui.run("REWIND_MAX_WORDS"));
});

test("tamaño de letra: pasos fijos, con tope y vuelta al normal", () => {
  const ui = loadUI();
  assert.equal(ui.run("fontScale()"), 100);            // sin elegir: normal
  ui.storage.set("fontScale", "137");
  assert.equal(ui.run("fontScale()"), 100);            // valor que no está en la lista: normal
  assert.equal(ui.run("nextFontScale(100, 1)"), 110);
  assert.equal(ui.run("nextFontScale(100, -1)"), 90);
  assert.equal(ui.run("nextFontScale(175, 1)"), 175);  // tope arriba
  assert.equal(ui.run("nextFontScale(80, -1)"), 80);   // tope abajo
  assert.equal(ui.run("nextFontScale(150, 0)"), 100);  // ⌘0: normal
});
