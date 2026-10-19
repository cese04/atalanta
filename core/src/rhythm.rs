//! Ritmo de lectura: cuánto se muestra cada palabra y qué palabras son diálogo. Se calcula una
//! vez al abrir el libro; la interfaz solo multiplica por el tiempo de una palabra a la
//! velocidad elegida y aplica el arranque gradual (ver delayFor en ui/rhythm.js).

use serde::Serialize;

// Marcas de cada palabra (se combinan sumándolas).
pub const SPEECH: u8 = 1;       // es diálogo (se muestra en cursiva)
pub const SENTENCE_END: u8 = 2; // termina en . ! ? …
pub const COMMA: u8 = 4;        // termina en , ; :
pub const ABBREVIATION: u8 = 8; // "Sr.", "Mr."…: termina en punto pero no cierra la frase

// Pausas, como múltiplos del tiempo de una palabra normal (con "Ritmo natural").
pub const PAUSE_COMMA: f32 = 1.5;     // , ; :
pub const PAUSE_SENTENCE: f32 = 2.0;  // . ! ?
pub const PAUSE_ELLIPSIS: f32 = 2.5;  // … o ...
pub const PAUSE_PARAGRAPH: f32 = 2.5; // fin de párrafo
pub const PAUSE_NEW_VOICE: f32 = 3.0; // fin de párrafo cuando el siguiente es otra voz (diálogo)
pub const PAUSE_ASIDE: f32 = 1.3;     // antes de un inciso que abre con ( o —
pub const PAUSE_NUMBER: f32 = 1.5;    // palabras con cifras: 1789, 3.5
pub const LONG_WORD_EXTRA: f32 = 0.5; // extra máximo para palabras de más de 8 letras

#[derive(Serialize, Clone, Default)]
pub struct Rhythm {
    pub pauses: Vec<f32>,       // pausa de cada palabra con ritmo natural (2.5 = 2.5 veces lo normal)
    pub flags: Vec<u8>,         // marcas de cada palabra (SPEECH, SENTENCE_END…)
    pub separators: Vec<usize>, // párrafos que son solo un separador de sección: "* * *", "§"
}

pub fn analyze(words: &[String], paragraphs: &[usize]) -> Rhythm {
    let speech = find_speech(words, paragraphs);
    let starts: std::collections::HashSet<usize> = paragraphs.iter().copied().collect();
    let mut flags = Vec::with_capacity(words.len());
    let mut pauses = Vec::with_capacity(words.len());
    for (w, word) in words.iter().enumerate() {
        let next = words.get(w + 1).map(String::as_str).unwrap_or("");
        let mut flag = if speech[w] { SPEECH } else { 0 };
        if sentence_end(word) {
            flag |= SENTENCE_END;
        } else if comma(word) {
            flag |= COMMA;
        }
        if abbreviation(word) {
            flag |= ABBREVIATION;
        }
        flags.push(flag);
        pauses.push(natural_pause(word, next, flag, starts.contains(&(w + 1))));
    }
    let separators = (0..paragraphs.len()).filter(|&i| is_separator(paragraph(words, paragraphs, i))).collect();
    Rhythm { pauses, flags, separators }
}

/// Pausa de una palabra con ritmo natural (`next`: la siguiente; `paragraph_ends`: si con ella
/// termina el párrafo).
fn natural_pause(word: &str, next: &str, flag: u8, paragraph_ends: bool) -> f32 {
    let mut pause = if flag & SENTENCE_END != 0 {
        PAUSE_SENTENCE
    } else if flag & COMMA != 0 {
        PAUSE_COMMA
    } else {
        1.0
    };
    if ellipsis(word) {
        pause = PAUSE_ELLIPSIS;
    }
    if flag & ABBREVIATION != 0 {
        pause = 1.0;
    }
    if paragraph_ends {
        pause = pause.max(if opens_speech(next) { PAUSE_NEW_VOICE } else { PAUSE_PARAGRAPH });
    } else if next.starts_with(['(', '—', '–', '―']) {
        pause = pause.max(PAUSE_ASIDE);
    }
    pause * word_weight(word)
}

/// Las palabras largas y los números necesitan un poco más de tiempo.
fn word_weight(word: &str) -> f32 {
    let letters = word.chars().filter(|c| c.is_alphabetic()).count() as f32;
    let mut weight = 1.0 + LONG_WORD_EXTRA.min(((letters - 8.0) / 12.0).max(0.0));
    if word.chars().any(|c| c.is_ascii_digit()) {
        weight = weight.max(PAUSE_NUMBER);
    }
    weight
}

// ── Puntuación (español e inglés) ──

/// La palabra sin las comillas o paréntesis que cierran: «hola.» -> «hola.
fn without_closers(word: &str) -> &str {
    word.trim_end_matches(['"', '\'', '”', '’', '»', ')'])
}

fn sentence_end(word: &str) -> bool {
    without_closers(word).ends_with(['.', '!', '?', '…'])
}

fn ellipsis(word: &str) -> bool {
    let w = without_closers(word);
    w.ends_with('…') || w.ends_with("...")
}

fn comma(word: &str) -> bool {
    without_closers(word).ends_with([',', ';', ':'])
}

/// "Sr.", "(Mr.", "«Dra."…: terminan en punto pero no cierran la frase.
fn abbreviation(word: &str) -> bool {
    const LIST: [&str; 12] = ["mr", "mrs", "ms", "dr", "dra", "sr", "sra", "srta", "st", "jr", "prof", "vs"];
    let w = word.trim_start_matches(['(', '«', '“', '"', '¿', '¡']).to_lowercase();
    w.strip_suffix('.').is_some_and(|base| LIST.contains(&base))
}

fn is_dash(c: char) -> bool {
    matches!(c, '—' | '–' | '―')
}

/// Alguien empieza a hablar: raya o comillas al principio.
fn opens_speech(word: &str) -> bool {
    word.starts_with(['—', '–', '―', '“', '"', '«', '‘'])
}

// ── Párrafos ──

fn paragraph<'a>(words: &'a [String], paragraphs: &[usize], i: usize) -> &'a [String] {
    let end = paragraphs.get(i + 1).copied().unwrap_or(words.len());
    &words[paragraphs[i]..end]
}

/// ¿Es un separador de sección? Pocas "palabras", sin letras ni cifras: "* * *", "§".
fn is_separator(words: &[String]) -> bool {
    words.len() <= 5 && words.iter().all(|w| !w.chars().any(char::is_alphanumeric))
}

/// Qué palabras son diálogo. Reconoce:
///   con raya:      —Ya voy —dijo Juan—. Espera.   ("dijo Juan" es el narrador)
///   con comillas:  He said, “Come here.”  ·  «Ven aquí», dijo.
fn find_speech(words: &[String], paragraphs: &[usize]) -> Vec<bool> {
    let mut speech = vec![false; words.len()];
    for i in 0..paragraphs.len() {
        let start = paragraphs[i];
        let these = paragraph(words, paragraphs, i);
        if these.first().is_some_and(|w| w.starts_with(is_dash)) {
            // Párrafo que abre con raya: es diálogo, salvo los incisos del narrador entre rayas.
            let mut talking = true;
            for (k, word) in these.iter().enumerate() {
                if k > 0 && word.starts_with(is_dash) {
                    talking = false; // "—dijo": empieza el narrador
                }
                speech[start + k] = talking;
                if !talking && closes_aside(word) {
                    talking = true; // "Juan—.": vuelve el diálogo
                }
            }
        } else {
            // Lo que está entre comillas. Se reinicia en cada párrafo.
            let mut closer: Option<char> = None;
            for (k, word) in these.iter().enumerate() {
                let mut rest = word.as_str();
                if closer.is_none() {
                    let after = rest.trim_start_matches(['(', '¿', '¡']);
                    if let Some(open) = after.chars().next() {
                        closer = match open {
                            '“' => Some('”'),
                            '«' => Some('»'),
                            '"' => Some('"'),
                            '‘' => Some('’'),
                            _ => None,
                        };
                        if closer.is_some() {
                            rest = &after[open.len_utf8()..]; // que "Hola" no se cierre con su propia comilla
                        }
                    }
                }
                if let Some(c) = closer {
                    speech[start + k] = true;
                    if rest.trim_end_matches(['.', ',', ';', ':', '!', '?', '…', ')']).ends_with(c) {
                        closer = None;
                    }
                }
            }
        }
    }
    speech
}

/// "Juan—." o "—dijo—,": una raya (no al principio) seguida solo de signos cierra el inciso.
fn closes_aside(word: &str) -> bool {
    let chars: Vec<char> = word.chars().collect();
    chars.iter().enumerate().rev().take_while(|(_, c)| !c.is_alphabetic()).any(|(i, c)| i > 0 && is_dash(*c))
}

// Pruebas: core/tests/rhythm.rs
#[cfg(test)]
#[path = "../tests/rhythm.rs"]
mod tests;
