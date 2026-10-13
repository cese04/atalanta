// Menú principal: la barra de menús de macOS (en Windows y Linux, dentro de la ventana).
// Se vuelve a construir entero cada vez que cambia algo (recientes, ajustes), así
// siempre muestra el estado actual. Usa funciones y ajustes de app.js y notes.js.

// Agrupa varias peticiones seguidas en una sola reconstrucción.
let menuTimer = null;
function buildMenu() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(createMenu, 50);
}

async function createMenu() {
  const separator = { item: "Separator" };
  const check = (text, checked, action, accelerator) => ({ text, checked, action, accelerator });
  const recent = recentBooks();
  const theme = localStorage.getItem("theme") || "tufte";

  const items = [
    // En macOS el primer menú lleva el nombre de la app.
    { text: "FastRead", items: [
      { item: { About: null }, text: "Acerca de FastRead" },
      separator,
      { item: "Hide", text: "Ocultar FastRead" },
      { item: "HideOthers", text: "Ocultar otros" },
      { item: "ShowAll", text: "Mostrar todo" },
      separator,
      { item: "Quit", text: "Salir de FastRead" },
    ]},

    { text: "Archivo", items: [
      { text: "Abrir…", accelerator: "CmdOrCtrl+O", action: chooseBook },
      { text: "Abrir reciente", items: recent.length
        ? [
            ...recent.map((r) => ({ text: recentLabel(r), action: () => openBook(r.path) })),
            separator,
            { text: "Borrar lista", action: clearRecent },
          ]
        : [{ text: "Sin libros recientes", enabled: false }] },
      separator,
      { text: notesDir ? `Carpeta de notas: ${shortPath(notesDir)}…` : "Elegir carpeta de notas…", action: chooseNotesDir },
      { text: "Importar subrayados de Kindle…", action: importKindle },
      { text: "Importar subrayados de Kobo…", action: importKobo },
      separator,
      { item: "CloseWindow", text: "Cerrar ventana" },
    ]},

    // Necesario para copiar, pegar y deshacer al escribir notas.
    { text: "Edición", items: [
      { item: "Undo", text: "Deshacer" },
      { item: "Redo", text: "Rehacer" },
      separator,
      { item: "Cut", text: "Cortar" },
      { item: "Copy", text: "Copiar" },
      { item: "Paste", text: "Pegar" },
      { item: "SelectAll", text: "Seleccionar todo" },
    ]},

    { text: "Lectura", items: [
      { text: "Leer / pausar  (Espacio)", action: toggle },
      separator,
      { text: "Capítulo anterior", accelerator: "CmdOrCtrl+[", action: () => jumpChapter(-1) },
      { text: "Capítulo siguiente", accelerator: "CmdOrCtrl+]", action: () => jumpChapter(1) },
      separator,
      { text: "Más rápido  (↑)", action: () => setWpm(wpm + 25) },
      { text: "Más lento  (↓)", action: () => setWpm(wpm - 25) },
      separator,
      check("Modo subrayado  (S)", highlighting, () => setHighlighting(!highlighting)),
    ]},

    { text: "Ver", items: [
      ...Object.entries(toggles).map(([key, t]) =>
        check(t.label, isOn(key), () => setToggle(key, !isOn(key)), t.accelerator)),
      separator,
      { text: "Tema", items: THEMES.map(([id, name]) => check(name, id === theme, () => setTheme(id))) },
      { text: "Tipo de letra", items: fontItems(check, separator) },
      { text: `Tamaño de letra (${fontScale()} %)`, items: [
        { text: "Más grande", accelerator: "CmdOrCtrl+=", action: () => changeFontSize(1) },
        { text: "Más pequeña", accelerator: "CmdOrCtrl+-", action: () => changeFontSize(-1) },
        { text: "Tamaño normal", accelerator: "CmdOrCtrl+0", action: () => changeFontSize(0) },
      ]},
      separator,
      { item: "Fullscreen", text: "Pantalla completa" },
    ]},

    { text: "Ayuda", items: [
      { text: "Atajos de teclado", accelerator: "CmdOrCtrl+/", action: () => toggleHelp(true) },
    ]},
  ];
  const menu = await window.__TAURI__.menu.Menu.new({ items: await Promise.all(items.map(makeItem)) });
  await menu.setAsAppMenu();
}

// Convierte la descripción de un elemento ({ text, action, items... }) en un elemento
// real del menú. Hay que crearlos así, uno por uno: si se pasan como objetos simples,
// Tauri dibuja el menú pero no ejecuta las acciones de los submenús.
async function makeItem(spec) {
  const { MenuItem, CheckMenuItem, Submenu, PredefinedMenuItem } = window.__TAURI__.menu;
  if (spec.item) return PredefinedMenuItem.new(spec);
  if (spec.items) return Submenu.new({ ...spec, items: await Promise.all(spec.items.map(makeItem)) });
  if ("checked" in spec) return CheckMenuItem.new(spec);
  return MenuItem.new(spec);
}

// Tipos de letra: "Según el tema" y luego las fuentes agrupadas, con un encabezado
// (inactivo) por grupo. Una fuente solo aparece marcada si se eligió a propósito.
function fontItems(check, separator) {
  const items = [
    { ...check(`Según el tema (${fontName(themeFont())})`, fontMode() === "auto", () => setFont("auto")), group: "" },
  ];
  for (const [id, name, group] of FONTS) {
    if (!items.length || items.at(-1).group !== group) {
      if (items.length) items.push(separator);
      items.push({ text: group, enabled: false, group });
    }
    items.push({ ...check(name, id === fontMode(), () => setFont(id)), group });
  }
  return items.map(({ group, ...item }) => item); // `group` solo sirve para agrupar
}

// ── Libros recientes: [{ path, title, words }], el más reciente primero ──

function recentBooks() {
  try {
    return JSON.parse(localStorage.getItem("recent")) || [];
  } catch {
    return [];
  }
}

function addRecent() {
  const list = recentBooks().filter((r) => r.path !== path);
  list.unshift({ path, title: book.title, words: book.words.length });
  localStorage.setItem("recent", JSON.stringify(list.slice(0, 10)));
  buildMenu();
}

function removeRecent(p) {
  localStorage.setItem("recent", JSON.stringify(recentBooks().filter((r) => r.path !== p)));
  buildMenu();
}

function clearRecent() {
  localStorage.removeItem("recent");
  buildMenu();
}

// "Rayuela — 34 %"
function recentLabel(r) {
  const read = Number(localStorage.getItem("pos:" + r.path)) || 0;
  return `${r.title} — ${percent(read, r.words)}`;
}

// "/Users/ana/Notas/Libros" -> "~/Notas/Libros"; si es largo, solo las dos últimas carpetas.
function shortPath(p) {
  const parts = p.replace(/^\/Users\/[^/]+/, "~").split("/");
  return parts.length > 3 ? "…/" + parts.slice(-2).join("/") : parts.join("/");
}
