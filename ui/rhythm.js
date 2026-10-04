// Ritmo de lectura: cuánto tiempo se muestra cada palabra y qué palabras son diálogo.
// Usa `book`, `wpm`, `natural` y `rampLeft`, definidos en app.js.

// ── Valores fáciles de ajustar ──

const BREATH_MS = 700;   // pantalla vacía antes de un capítulo (y de una sección, con ritmo natural)
const CARD_MS = 2000;    // tiempo que se muestra el título del capítulo
const RAMP_WORDS = 15;   // palabras para pasar de media velocidad a la normal
const BLINK_MS = 120;    // parpadeo al empezar un párrafo (ritmo natural)

// Pausas, como múltiplos del tiempo de una palabra normal.
const PAUSE = {
  comma: 1.5,      // , ; :
  sentence: 2,     // . ! ?
  // Las siguientes solo con "Ritmo natural":
  ellipsis: 2.5,   // … o ...
  paragraph: 2.5,  // fin de párrafo
  newVoice: 3,     // fin de párrafo cuando el siguiente es otra voz (diálogo)
  aside: 1.3,      // antes de un inciso que abre con ( o —
  number: 1.5,     // palabras con cifras: 1789, 3.5
  longWord: 0.5,   // extra máximo para palabras de más de 8 letras
};

// ── Reconocer puntuación (español e inglés) ──

const SENTENCE_END = /[.!?…]["'”’»)]*$/;
const ELLIPSIS = /(…|\.\.\.)["'”’»)]*$/;
const COMMA = /[,;:]["'”’»)]*$/;
const ABBREVIATION = /^[(«“"¿¡]*(mr|mrs|ms|dr|dra|sr|sra|srta|st|jr|prof|vs)\.$/i; // no terminan frase
const DASH = /^[—–―]/;              // raya: diálogo o inciso
const OPENS_SPEECH = /^[—–―“"«‘]/;  // alguien empieza a hablar

// Tiempo (ms) que se muestra la palabra número `w`.
function delayFor(w) {
  const word = book.words[w];
  let pause = 1;
  if (SENTENCE_END.test(word)) pause = PAUSE.sentence;
  else if (COMMA.test(word)) pause = PAUSE.comma;

  if (natural) {
    const next = book.words[w + 1] ?? "";
    if (ELLIPSIS.test(word)) pause = PAUSE.ellipsis;
    if (ABBREVIATION.test(word)) pause = 1;
    if (isParagraphStart(w + 1)) {
      pause = Math.max(pause, OPENS_SPEECH.test(next) ? PAUSE.newVoice : PAUSE.paragraph);
    } else if (/^[(—–―]/.test(next)) {
      pause = Math.max(pause, PAUSE.aside);
    }
    pause *= wordWeight(word);
  }

  if (rampLeft > 0) {
    pause *= 1 + rampLeft / RAMP_WORDS; // arranque gradual: de 2x a 1x
    rampLeft--;
  }
  return (60000 / wpm) * pause;
}

// Las palabras largas y los números necesitan un poco más de tiempo.
function wordWeight(word) {
  const letters = word.replace(/[^\p{L}]/gu, "").length;
  let weight = 1 + Math.min(PAUSE.longWord, Math.max(0, (letters - 8) / 12));
  if (/\d/.test(word)) weight = Math.max(weight, PAUSE.number);
  return weight;
}

// ¿El párrafo `i` es un separador de sección, como "* * *" o "§"? (pocas palabras, sin letras ni cifras)
function isSeparator(i) {
  const words = book.words.slice(book.paragraphs[i], paragraphEnd(i));
  return words.length <= 5 && words.every((w) => !/[\p{L}\p{N}]/u.test(w));
}

// Marca con 1 las palabras que son diálogo (se muestran en cursiva). Reconoce:
//   con raya:      —Ya voy —dijo Juan—. Espera.   ("dijo Juan" es el narrador)
//   con comillas:  He said, “Come here.”  ·  «Ven aquí», dijo.
function findSpeech() {
  const speech = new Uint8Array(book.words.length);
  const CLOSERS = { "“": "”", "«": "»", '"': '"', "‘": "’" };

  book.paragraphs.forEach((start, i) => {
    const end = paragraphEnd(i);

    if (DASH.test(book.words[start])) {
      // Párrafo que abre con raya: es diálogo, salvo los incisos del narrador entre rayas.
      let talking = true;
      for (let w = start; w < end; w++) {
        const word = book.words[w];
        if (w > start && DASH.test(word)) talking = false;              // "—dijo": empieza el narrador
        speech[w] = talking ? 1 : 0;
        if (!talking && /.[—–―][^\p{L}]*$/u.test(word)) talking = true; // "Juan—.": vuelve el diálogo
      }
    } else {
      // Lo que está entre comillas. Se reinicia en cada párrafo.
      let closer = null;
      for (let w = start; w < end; w++) {
        let word = book.words[w];
        if (!closer) {
          const open = word.match(/^[(¿¡]*(["“«‘])/);
          if (open) {
            closer = CLOSERS[open[1]];
            word = word.slice(open[0].length); // para que "Hola" no se cierre con su propia comilla
          }
        }
        if (closer) {
          speech[w] = 1;
          if (word.replace(/[.,;:!?…)]+$/, "").endsWith(closer)) closer = null;
        }
      }
    }
  });
  return speech;
}
