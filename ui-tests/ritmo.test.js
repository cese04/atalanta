// Pruebas de ui/rhythm.js: diálogos y duración de cada palabra.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadUI, bookFrom } = require("./load-ui.js");

// Marca con *asteriscos* las palabras que la app considera diálogo.
function dialogue(text) {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom(text))}`);
  const speech = ui.get("Array.from(findSpeech())");
  return ui.get("book.words").map((w, i) => (speech[i] ? `*${w}*` : w)).join(" ");
}

test("diálogo con raya: los incisos del narrador no son diálogo", () => {
  assert.equal(dialogue("—Ya voy —dijo Juan—. Espera un poco."), "*—Ya* *voy* —dijo Juan—. *Espera* *un* *poco.*");
  assert.equal(dialogue("—No —respondió—, no lo creo."), "*—No* —respondió—, *no* *lo* *creo.*");
  assert.equal(dialogue("—¿Qué hora es? —preguntó ella."), "*—¿Qué* *hora* *es?* —preguntó ella.");
});

test("diálogo entre comillas, en español e inglés", () => {
  assert.equal(dialogue("Entonces dijo: «Ven aquí», y se fue."), "Entonces dijo: *«Ven* *aquí»,* y se fue.");
  assert.equal(dialogue("He said, “Come here.” Then he left."), "He said, *“Come* *here.”* Then he left.");
  assert.equal(dialogue("“Don’t go,” she whispered, “please.”"), "*“Don’t* *go,”* she whispered, *“please.”*");
  assert.equal(dialogue('"Hello," said Mr. Smith.'), '*"Hello,"* said Mr. Smith.');
});

test("un apóstrofo no abre ni cierra diálogo", () => {
  assert.equal(dialogue("The students’ books were old."), "The students’ books were old.");
});

test("las comillas se reinician en cada párrafo", () => {
  assert.equal(dialogue("«Una cita sin cerrar|Otro párrafo normal."), "*«Una* *cita* *sin* *cerrar* Otro párrafo normal.");
});

test("duración de cada palabra con ritmo natural", () => {
  const ui = loadUI();
  ui.run("wpm = 300; natural = true; rampLeft = 0");
  ui.run(`book = ${JSON.stringify(bookFrom(
    "Era el año 1789, en París. Mr. Smith dijo desafortunadamente algo (sin pensar) y esperó... nada.|—¿Vienes?|* * *|Fin."))}`);
  const words = ui.get("book.words");
  const times = Object.fromEntries(words.map((w, i) => [w, Math.round((ui.run(`delayFor(${i})`) / 200) * 100) / 100]));
  assert.equal(times["Era"], 1);
  assert.equal(times["1789,"], 2.25);              // coma (1.5) × número (1.5)
  assert.equal(times["París."], 2);                // fin de frase
  assert.equal(times["Mr."], 1);                   // abreviatura: no es fin de frase
  assert.equal(times["desafortunadamente"], 1.5);  // palabra larga
  assert.equal(times["algo"], 1.3);                // antes de un inciso "("
  assert.equal(times["esperó..."], 2.5);           // puntos suspensivos
  assert.equal(times["nada."], 3);                 // fin de párrafo y sigue otra voz
  assert.equal(times["—¿Vienes?"], 2.5);           // fin de párrafo
});

test("sin ritmo natural solo hay pausas de frase y coma", () => {
  const ui = loadUI();
  ui.run("wpm = 300; natural = false; rampLeft = 0");
  ui.run(`book = ${JSON.stringify(bookFrom("Una palabra desafortunadamente, larga.|Otra"))}`);
  assert.deepEqual([0, 1, 2, 3].map((i) => ui.run(`delayFor(${i})`) / 200), [1, 1, 1.5, 2]);
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

test("separadores de sección", () => {
  const ui = loadUI();
  ui.run(`book = ${JSON.stringify(bookFrom("Texto.|* * *|§|Capítulo 1"))}`);
  assert.deepEqual([0, 1, 2, 3].map((i) => ui.run(`isSeparator(${i})`)), [false, true, true, false]);
});
