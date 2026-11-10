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

test("progreso del capítulo actual", () => {
  const ui = loadUI();
  const toc = [{ title: "Uno", level: 0, word: 0 }, { title: "Dos", level: 0, word: 4 }];
  ui.run(`book = ${JSON.stringify(bookFrom("a b c d e f g h", { toc }))}; lengths = chapterLengths()`);
  const progress = (p) => ui.run(`pos = ${p}; chapterProgress(chapterAt(${p}))`);
  assert.equal(progress(0), 0);    // inicio del capítulo "Uno"
  assert.equal(progress(2), 0.5);  // a la mitad
  assert.equal(progress(4), 0);    // empieza "Dos": vuelve a cero
  assert.equal(progress(7), 0.75);
  assert.equal(ui.run("chapterProgress(-1)"), 0); // sin capítulo
});

test("formato de cada párrafo en la vista de pausa", () => {
  const ui = loadUI();
  const book = bookFrom("Capítulo uno|Texto.|Una cita.|* * *|Otra escena.", {
    toc: [{ title: "Capítulo uno", level: 0, word: 0 }],
    kinds: ["h1", "", "quote", "", ""],
    scene_breaks: [4],
  });
  ui.run(`book = ${JSON.stringify(book)}; separators = new Set([3])`); // "* * *" (lo detecta Rust)
  const classes = ui.get("book.paragraphs.map((_, i) => paragraphClass(i, new Set(book.toc.map((c) => c.word)), new Set(book.scene_breaks)))");
  assert.deepEqual(classes, ["h1 chapter", "", "quote", "separator", "scene"]);
});

test("estilos del libro: tramos a estilo por palabra y su clase de CSS", () => {
  const ui = loadUI();
  assert.deepEqual(ui.get("Array.from(expandStyles([[1, 3, 1], [4, 5, 6]], 6))"), [0, 1, 1, 0, 6, 0]);
  assert.equal(ui.run("styleClass(0)"), "");
  assert.equal(ui.run("styleClass(1)"), "italic");
  assert.equal(ui.run("styleClass(3)"), "italic bold");
  assert.equal(ui.run("styleClass(8)"), "smaller");
});

test("tipo de letra: según el tema, salvo que se elija una a propósito", () => {
  const ui = loadUI();
  assert.equal(ui.run("fontMode()"), "auto");          // sin elegir: según el tema
  assert.equal(ui.run("currentFont()"), "etbook");     // tema por defecto (Tufte) -> ET Book
  ui.storage.set("theme", "typewriter-dark");
  assert.equal(ui.run("currentFont()"), "quattro");    // Typewriter -> iA Writer Quattro
  ui.storage.set("theme", "nord");
  assert.equal(ui.run("currentFont()"), "serif");      // tema sin fuente propia -> Iowan
  ui.storage.set("font", "atkinson");
  assert.equal(ui.run("currentFont()"), "atkinson");   // elegida a propósito: se respeta
  ui.storage.set("theme", "tufte");
  assert.equal(ui.run("currentFont()"), "atkinson");   // aunque cambie el tema
  ui.storage.set("font", "comic-sans");
  assert.equal(ui.run("fontMode()"), "auto");          // valor no válido: según el tema
});

test("tipo de letra: el menú agrupa las fuentes con un encabezado por grupo", () => {
  const ui = loadUI();
  const items = ui.get('fontItems((text, checked) => ({ text, checked }), { item: "Separator" })');
  assert.deepEqual(items.map((i) => i.item || (i.enabled === false ? `[${i.text}]` : i.text)), [
    "Según el tema (ET Book)",
    "Separator",
    "[Con serifa]", "Iowan Old Style", "New York", "Charter", "ET Book",
    "Separator",
    "[Sin serifa]", "San Francisco", "Atkinson Hyperlegible", "iA Writer Quattro",
  ]);
  assert.equal(items.find((i) => i.checked).text, "Según el tema (ET Book)"); // marcado por defecto
});

test("marcas de capítulo: principales siempre, subcapítulos solo del capítulo actual", () => {
  const ui = loadUI();
  const toc = [
    { title: "Uno", level: 0, word: 0 },
    { title: "1.1", level: 1, word: 20 },
    { title: "Dos", level: 0, word: 50 },
    { title: "2.1", level: 1, word: 70 },
    { title: "2.2", level: 1, word: 90 },
  ];
  const ticks = (pos, gap = 0) => ui.get(`tickPositions(${JSON.stringify(toc)}, 101, ${pos}, ${gap})`);
  // En "Uno": la marca de "Dos" y la corta de 1.1. El principio del libro no lleva marca.
  assert.deepEqual(ticks(10), [{ at: 0.5, sub: false }, { at: 0.2, sub: true }]);
  // En "Dos": sus subcapítulos, no los de "Uno".
  assert.deepEqual(ticks(60), [{ at: 0.5, sub: false }, { at: 0.7, sub: true }, { at: 0.9, sub: true }]);
  // Marcas demasiado juntas: se omite la que queda a menos del mínimo de la anterior.
  assert.deepEqual(ticks(60, 0.25), [{ at: 0.5, sub: false }, { at: 0.7, sub: true }]);
});

test("índice: los subcapítulos solo se ven dentro del capítulo actual", () => {
  const ui = loadUI();
  const toc = [
    { title: "Prólogo", level: 1, word: 0 },
    { title: "Uno", level: 0, word: 10 },
    { title: "1.1", level: 1, word: 20 },
    { title: "1.1.1", level: 2, word: 30 },
    { title: "Dos", level: 0, word: 50 },
    { title: "2.1", level: 1, word: 70 },
  ];
  const visible = (c) => ui.get(`visibleChapters(${JSON.stringify(toc)}, ${c})`);
  assert.deepEqual(visible(1), [true, true, true, true, true, false]);  // en "Uno"
  assert.deepEqual(visible(3), [true, true, true, true, true, false]);  // en un subcapítulo de "Uno"
  assert.deepEqual(visible(5), [true, true, false, false, true, true]); // en "2.1"
  assert.deepEqual(visible(-1), [true, true, false, false, true, false]); // antes del primer capítulo
});

test("marcas de capítulo: si todo está en un nivel más profundo, ese cuenta como principal", () => {
  const ui = loadUI();
  const toc = [{ title: "A", level: 1, word: 0 }, { title: "B", level: 1, word: 40 }];
  assert.deepEqual(ui.get(`tickPositions(${JSON.stringify(toc)}, 81, 0, 0)`), [{ at: 0.5, sub: false }]);
});
