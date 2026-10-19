// Pruebas de src/rhythm.rs. Se compilan como parte de ese archivo
// (ver `mod tests` al final), así que pueden usar sus funciones internas.

use super::*;

/// Palabras y párrafos a partir de texto: "|" separa párrafos.
pub fn book_from(text: &str) -> (Vec<String>, Vec<usize>) {
    let (mut words, mut paragraphs) = (Vec::new(), Vec::new());
    for p in text.split('|') {
        paragraphs.push(words.len());
        words.extend(p.split_whitespace().map(String::from));
    }
    (words, paragraphs)
}

/// Marca con *asteriscos* las palabras que se consideran diálogo.
fn dialogue(text: &str) -> String {
    let (words, paragraphs) = book_from(text);
    let rhythm = analyze(&words, &paragraphs);
    words.iter().zip(&rhythm.flags).map(|(w, f)| if f & SPEECH != 0 { format!("*{w}*") } else { w.clone() }).collect::<Vec<_>>().join(" ")
}

#[test]
fn dialogo_con_raya_sin_los_incisos_del_narrador() {
    assert_eq!(dialogue("—Ya voy —dijo Juan—. Espera un poco."), "*—Ya* *voy* —dijo Juan—. *Espera* *un* *poco.*");
    assert_eq!(dialogue("—No —respondió—, no lo creo."), "*—No* —respondió—, *no* *lo* *creo.*");
    assert_eq!(dialogue("—¿Qué hora es? —preguntó ella."), "*—¿Qué* *hora* *es?* —preguntó ella.");
}

#[test]
fn dialogo_entre_comillas_en_espanol_e_ingles() {
    assert_eq!(dialogue("Entonces dijo: «Ven aquí», y se fue."), "Entonces dijo: *«Ven* *aquí»,* y se fue.");
    assert_eq!(dialogue("He said, “Come here.” Then he left."), "He said, *“Come* *here.”* Then he left.");
    assert_eq!(dialogue("“Don’t go,” she whispered, “please.”"), "*“Don’t* *go,”* she whispered, *“please.”*");
    assert_eq!(dialogue("\"Hello,\" said Mr. Smith."), "*\"Hello,\"* said Mr. Smith.");
}

#[test]
fn un_apostrofo_no_abre_ni_cierra_dialogo() {
    assert_eq!(dialogue("The students’ books were old."), "The students’ books were old.");
}

#[test]
fn las_comillas_se_reinician_en_cada_parrafo() {
    assert_eq!(dialogue("«Una cita sin cerrar|Otro párrafo normal."), "*«Una* *cita* *sin* *cerrar* Otro párrafo normal.");
}

#[test]
fn pausa_de_cada_palabra_con_ritmo_natural() {
    let (words, paragraphs) =
        book_from("Era el año 1789, en París. Mr. Smith dijo desafortunadamente algo (sin pensar) y esperó... nada.|—¿Vienes?|* * *|Fin.");
    let rhythm = analyze(&words, &paragraphs);
    let pause = |w: &str| rhythm.pauses[words.iter().position(|x| x == w).unwrap()];
    assert_eq!(pause("Era"), 1.0);
    assert_eq!(pause("1789,"), 2.25);              // coma (1.5) × número (1.5)
    assert_eq!(pause("París."), 2.0);              // fin de frase
    assert_eq!(pause("Mr."), 1.0);                 // abreviatura: no es fin de frase
    assert_eq!(pause("desafortunadamente"), 1.5);  // palabra larga
    assert_eq!(pause("algo"), 1.3);                // antes de un inciso "("
    assert_eq!(pause("esperó..."), 2.5);           // puntos suspensivos
    assert_eq!(pause("nada."), 3.0);               // fin de párrafo y sigue otra voz
    assert_eq!(pause("—¿Vienes?"), 2.5);           // fin de párrafo
}

#[test]
fn marcas_de_puntuacion() {
    let (words, paragraphs) = book_from("Hola, dijo el Sr. Pérez. Fin");
    let flags = analyze(&words, &paragraphs).flags;
    assert_eq!(flags, [COMMA, 0, 0, SENTENCE_END | ABBREVIATION, SENTENCE_END, 0]);
}

#[test]
fn separadores_de_seccion() {
    let (words, paragraphs) = book_from("Texto.|* * *|§|Capítulo 1");
    assert_eq!(analyze(&words, &paragraphs).separators, [1, 2]);
}
