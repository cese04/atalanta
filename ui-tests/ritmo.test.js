// Pruebas de ui/rhythm.js: el tiempo de cada palabra en la interfaz y dónde seguir al reanudar.
// La pausa de cada palabra, el diálogo y los separadores los calcula Rust (core/tests/rhythm.rs).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadUI, bookFrom } = require("./load-ui.js");

const [SPEECH, SENTENCE_END, COMMA, ABBREVIATION] = [1, 2, 4, 8]; // como en core/src/rhythm.rs

test("con ritmo natural se usa la pausa calculada por Rust", () => {
  const ui = loadUI();
  ui.run(`wpm = 300; natural = true; rampLeft = 0`);
  ui.run(`book = ${JSON.stringify(bookFrom("uno dos tres", { rhythm: { pauses: [1, 2.25, 3] } }))}`);
  assert.deepEqual([0, 1, 2].map((i) => ui.run(`delayFor(${i})`) / 200), [1, 2.25, 3]);
});

test("sin ritmo natural solo hay pausas de frase y coma", () => {
  const ui = loadUI();
  ui.run(`wpm = 300; natural = false; rampLeft = 0`);
  const flags = [0, COMMA, SENTENCE_END, SENTENCE_END | ABBREVIATION];
  ui.run(`book = ${JSON.stringify(bookFrom("Una palabra, larga. Sr.", { rhythm: { pauses: [9, 9, 9, 9], flags } }))}`);
  assert.deepEqual([0, 1, 2, 3].map((i) => ui.run(`delayFor(${i})`) / 200), [1, 1.5, 2, 2]);
});

test("arranque gradual: empieza al doble y vuelve a la normalidad", () => {
  const ui = loadUI();
  ui.run(`wpm = 300; natural = false; book = ${JSON.stringify(bookFrom("a b c d e f g h i j k l m n o p q"))}`);
  ui.run("rampLeft = RAMP_WORDS");
  const factors = ui.get("book.words.map((w, i) => delayFor(i) / 200)");
  assert.equal(factors[0], 2);
  assert.ok(factors[7] > 1 && factors[7] < 2);
  assert.equal(factors[15], 1);
});

test("diálogo y separadores, según el ritmo del libro", () => {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom("—Hola —dijo.|* * *", { rhythm: { flags: [SPEECH, 0, 0, 0, 0], separators: [1] } }))}`);
  ui.run("separators = new Set(book.rhythm.separators)");
  assert.deepEqual([0, 1].map((w) => ui.run(`isSpeech(${w})`)), [true, false]);
  assert.deepEqual([0, 1].map((i) => ui.run(`isSeparator(${i})`)), [false, true]);
});

test("inicio de la frase: sin salir del párrafo y sin cortar en abreviaturas", () => {
  const ui = loadUI();
  //  0      1      2   3  4    5     6  7       8      9    10
  // "Llegó tarde. Vio al Sr. Pérez y sonrió.|Nueva idea aquí."
  const flags = [0, SENTENCE_END, 0, 0, SENTENCE_END | ABBREVIATION, 0, 0, SENTENCE_END, 0, 0, SENTENCE_END];
  ui.run(`book = ${JSON.stringify(bookFrom("Llegó tarde. Vio al Sr. Pérez y sonrió.|Nueva idea aquí.", { rhythm: { flags } }))}`);
  const word = (p) => ui.run(`book.words[sentenceStart(${p})]`);
  assert.equal(word(1), "Llegó"); // primera frase del libro
  assert.equal(word(6), "Vio");   // "Sr." no termina la frase
  assert.equal(word(2), "Vio");   // ya en el inicio de la frase
  assert.equal(word(9), "Nueva"); // no salta al párrafo anterior
});

test("al reanudar: retrocede solo tras una pausa larga y si no se eligió otra palabra", () => {
  const ui = loadUI();
  const flags = [0, SENTENCE_END, 0, 0, 0, 0, 0, SENTENCE_END];
  ui.run(`book = ${JSON.stringify(bookFrom("Primera frase. Segunda frase con varias palabras más.", { rhythm: { flags } }))}`);
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
