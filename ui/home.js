// ── Pantalla de inicio: el último libro en grande y los demás recientes en una lista ──
// Se ve al arrancar (si hay recientes) y se quita al abrir un libro. Las portadas son
// miniaturas que se guardan con cada reciente al abrir el libro (ver saveRecentCover).

const RECENT_COVER_HEIGHT = 360; // alto de esas miniaturas, en píxeles (12rem al doble de resolución)

function renderHome() {
  const [last, ...others] = recentBooks();
  $("home").hidden = !last;
  if (!last) return;
  $("homeCover").replaceChildren(coverOf(last, true));
  $("homeTitle").textContent = last.title;
  $("homeAuthor").textContent = last.author || "";
  $("homeContinue").textContent = `Seguir leyendo — ${percent(readOf(last), last.words)}`;
  $("homeLeft").textContent = `quedan ${formatMinutes((last.words - readOf(last)) / wpm)}`;
  $("homeRecent").hidden = !others.length;
  checkReaders();
  $("homeList").replaceChildren(
    ...others.map((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<button><span class="title"></span><span class="percent"></span><span class="meter"><span class="fill"></span></span></button>`;
      const button = li.firstChild;
      button.prepend(coverOf(r, false));
      button.querySelector(".title").textContent = r.title;
      button.querySelector(".percent").textContent = percent(readOf(r), r.words);
      button.querySelector(".fill").style.width = Math.min(100, (100 * readOf(r)) / Math.max(1, r.words)) + "%";
      button.onclick = () => openBook(r.path);
      return li;
    })
  );
}

// Un Kindle o Kobo conectado: una línea para importar sus subrayados (import.js). Se busca al
// mostrar la pantalla de inicio y cada pocos segundos mientras se vea, para notar el lector en
// cuanto se conecte.
const READERS_EVERY_MS = 5000;
async function checkReaders() {
  if ($("home").hidden) return;
  const { kindle, kobo } = await invoke("find_readers");
  const names = [kindle && "Kindle", kobo && "Kobo"].filter(Boolean);
  $("homeReader").hidden = !names.length;
  $("homeReaderName").textContent = `${names.join(" y ")} ${names.length > 1 ? "conectados" : "conectado"}`;
}
setInterval(checkReaders, READERS_EVERY_MS);
$("homeImport").onclick = importHighlights;

// Palabra donde te quedaste en un libro reciente.
const readOf = (r) => Number(localStorage.getItem("pos:" + r.path)) || 0;

// Miniatura de un reciente o, si no tiene, un rectángulo con filete (el grande, con el título).
function coverOf(r, big) {
  const cover = document.createElement(r.cover ? "img" : "span");
  cover.className = r.cover ? "cover" : "cover blank";
  if (r.cover) Object.assign(cover, { src: r.cover, alt: "" });
  else if (big) cover.textContent = r.title;
  return cover;
}

// Enter o Espacio (con el foco fuera de los botones) retoman el último libro (ver keydown en app.js).
$("homeContinue").onclick = () => openBook(recentBooks()[0].path);

// Guarda la miniatura de la portada del libro `p` en su entrada de recientes.
async function saveRecentCover(p, original) {
  const small = await shrinkImage(original, RECENT_COVER_HEIGHT);
  if (!small) return;
  const url = await new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result);
    reader.readAsDataURL(small.blob);
  });
  const list = recentBooks();
  const entry = list.find((r) => r.path === p);
  if (!entry) return;
  entry.cover = url;
  try {
    localStorage.setItem("recent", JSON.stringify(list));
  } catch {} // sin espacio: ese libro se queda sin miniatura
}
