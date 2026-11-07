// Carga los archivos de la interfaz (ui/) en un entorno simulado (sin navegador ni Tauri) para probar
// sus funciones con `node --test`. Los elementos de la página son objetos vacíos que
// aceptan cualquier operación; los comandos de Rust se simulan con `handle`.

const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

// Un "elemento" que acepta cualquier propiedad o llamada sin hacer nada.
function fakeElement() {
  return new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => "" : fakeElement()),
    set: () => true,
    apply: () => fakeElement(),
  });
}

function loadUI() {
  const files = {};    // archivos simulados: ruta -> contenido
  const storage = new Map();
  const handlers = {   // comandos de Rust simulados
    read_text: ({ path }) => files[path] ?? "",
    write_text: ({ path, content }) => { files[path] = content; },
    read_bytes: ({ path }) => {
      if (!(path in files)) throw "no existe";
      return files[path];
    },
    write_bytes: ({ path, bytes }) => { files[path] = bytes; },
  };

  const context = {
    console,
    document: {
      getElementById: fakeElement,
      querySelector: fakeElement,
      createElement: fakeElement,
      addEventListener() {},
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    getSelection: fakeElement,
    matchMedia: () => ({ matches: false }), // sin "movimiento reducido"
    setTimeout: () => 0, // los temporizadores (menú, avisos) no hacen falta en las pruebas
    clearTimeout() {},
    addEventListener() {},
    __TAURI__: {
      // Como en la app real, los argumentos viajan a "Rust" convertidos a JSON.
      core: { invoke: async (command, args) => handlers[command](JSON.parse(JSON.stringify(args))) },
      dialog: { open: async () => null },
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ["rhythm.js", "app.js", "pdf-reader.js", "notes.js", "import.js", "menu.js"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", "ui", file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }

  return {
    run: (code) => vm.runInContext(code, context), // evalúa código dentro de la interfaz
    // Igual, pero devuelve una copia (los arreglos del entorno simulado no se comparan bien con assert)
    get: (code) => JSON.parse(JSON.stringify(vm.runInContext(code, context))),
    handle: (command, fn) => (handlers[command] = fn),
    files,
    storage,
  };
}

// Un libro a partir de texto: "|" separa párrafos. Su ritmo (que en la app calcula Rust) es
// neutro salvo que se indique: todas las pausas en 1 y sin marcas.
function bookFrom(text, extra = {}) {
  const words = [];
  const paragraphs = [];
  for (const p of text.split("|")) {
    paragraphs.push(words.length);
    words.push(...p.trim().split(/\s+/));
  }
  const rhythm = { pauses: words.map(() => 1), flags: words.map(() => 0), separators: [], ...extra.rhythm };
  return { title: "Libro", author: "", toc: [], note_name: extra.title || "Libro", ...extra, words, paragraphs, rhythm };
}

module.exports = { loadUI, bookFrom };
