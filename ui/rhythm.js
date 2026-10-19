// Ritmo de lectura en la interfaz: cuánto tiempo se muestra cada palabra a la velocidad elegida.
// La pausa de cada palabra, qué es diálogo y qué párrafos son separadores los calcula Rust al
// abrir el libro (core/src/rhythm.rs) y llegan en `book.rhythm`. Aquí solo quedan los tiempos de
// la interfaz. Usa `book`, `wpm`, `natural` y `rampLeft`, definidos en app.js.

// ── Valores fáciles de ajustar ──

const BREATH_MS = 700;   // pantalla vacía antes de un capítulo (y de una sección, con ritmo natural)
const CARD_MS = 2000;    // tiempo que se muestra el título del capítulo
const RAMP_WORDS = 15;   // palabras para pasar de media velocidad a la normal
const BLINK_MS = 120;    // parpadeo al empezar un párrafo (ritmo natural)
const REWIND_AFTER_MS = 3000; // al reanudar tras una pausa más larga, se vuelve al inicio de la frase
const REWIND_MAX_WORDS = 30;  // …pero sin retroceder más de estas palabras (frases muy largas)

// Marcas de cada palabra en book.rhythm.flags (las mismas que en core/src/rhythm.rs).
const SPEECH = 1;       // diálogo
const SENTENCE_END = 2; // termina en . ! ? …
const COMMA = 4;        // termina en , ; :
const ABBREVIATION = 8; // "Sr.", "Mr.": termina en punto pero no cierra la frase

let separators = new Set(); // párrafos que son solo un separador, como "* * *" (book.rhythm.separators)

// Tiempo (ms) que se muestra la palabra número `w`. Con ritmo natural, la pausa que calculó
// Rust; sin él, solo frase (2×) y coma (1.5×).
function delayFor(w) {
  const flags = book.rhythm.flags[w];
  let pause = natural ? book.rhythm.pauses[w] : flags & SENTENCE_END ? 2 : flags & COMMA ? 1.5 : 1;
  if (rampLeft > 0) {
    pause *= 1 + rampLeft / RAMP_WORDS; // arranque gradual: de 2x a 1x
    rampLeft--;
  }
  return (60000 / wpm) * pause;
}

const isSpeech = (w) => (book.rhythm.flags[w] & SPEECH) !== 0;
const isSeparator = (i) => separators.has(i);
const closesSentence = (w) => (book.rhythm.flags[w] & (SENTENCE_END | ABBREVIATION)) === SENTENCE_END;

// Dónde seguir al reanudar la lectura: si la pausa fue larga y no se eligió otra palabra,
// desde el inicio de la frase (sin pasar del inicio del párrafo ni de REWIND_MAX_WORDS atrás).
function resumeFrom(p, pausedMs, chosen) {
  if (chosen || pausedMs < REWIND_AFTER_MS) return p;
  return Math.max(sentenceStart(p), p - REWIND_MAX_WORDS);
}

// Primera palabra de la frase que contiene a `p`, sin salir de su párrafo.
// "Sr." o "Mr." no cuentan como final de frase.
function sentenceStart(p) {
  const first = book.paragraphs[paragraphOf(p)];
  while (p > first && !closesSentence(p - 1)) p--;
  return p;
}
