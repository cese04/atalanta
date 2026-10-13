# FastRead

Lector veloz (palabra por palabra) para libros `.epub` y `.mobi`, hecho con Rust + Tauri.
Al pausar muestra el texto completo, donde puedes elegir desde dónde seguir y subrayar
fragmentos que se guardan como notas Markdown para Obsidian.

## Usar

- **Archivo › Abrir…** (⌘O) o **Abrir reciente**. Al iniciar, vuelve al último libro donde lo dejaste.
- Al reanudar tras una pausa de más de 3 segundos, la lectura vuelve al inicio de la frase
  (como mucho 30 palabras atrás), salvo que hayas elegido otra palabra durante la pausa.
- Todos los ajustes (temas, índice, gráfica de tiempos, palabras vecinas, ritmo natural) están en el menú **Ver**.
- Atajos: pulsa `?` o **Ayuda › Atajos de teclado** (⌘/).

| Tecla | Acción |
|---|---|
| `Espacio` | Leer / pausar |
| `←` `→` | Retroceder / avanzar 10 palabras |
| `↑` `↓` | Más rápido / más lento |
| `[` `]` (o ⌘[ ⌘]) | Capítulo anterior / siguiente |
| `S` | En pausa: modo subrayado, o subrayar el texto seleccionado |
| `Esc` | Salir del modo subrayado / cerrar la ayuda |
| ⌥⌘S | Mostrar u ocultar el índice |

## Subrayados y notas

1. **Archivo › Elegir carpeta de notas…** (por ejemplo, una carpeta dentro de tu bóveda de Obsidian).
   Si no la has elegido, se te pide al guardar el primer subrayado.
2. Pausa, pulsa `S` y selecciona un fragmento con el ratón. Se abre el editor: puedes corregir
   el texto y añadir un comentario. ⌘ Enter guarda.
3. En modo subrayado, un clic sobre un subrayado lo abre para editarlo o eliminarlo.

Por cada libro se escriben dos archivos en la carpeta de notas:

- `Título.md`: el resumen del libro (`## Resumen`, si sus metadatos lo traen) y una sección
  por origen (`## FastRead`, `## Kindle`, `## Kobo`), con las citas agrupadas por capítulo y
  cada una con su comentario. FastRead solo reescribe lo que hay
  entre sus marcas (`<!-- fastread:… -->`): lo que escribas fuera se conserva.
- `.fastread/Título.json`: los subrayados de FastRead, editables (Obsidian no muestra carpetas que empiezan con punto).

## Importar de Kindle y Kobo

Conecta el lector por USB y elige **Archivo › Importar subrayados de Kindle…** o **…de Kobo…**.
Si no se encuentra el lector, se te pide el archivo:

- Kindle: `documents/My Clippings.txt`.
- Kobo: `.kobo/KoboReader.sqlite` (carpeta oculta: en la ventana de archivos, ⌘⇧. las muestra).

Cada importación reemplaza la sección de ese origen en los libros que trae; no duplica al
reimportar y no toca los demás libros. Kindle guarda cada edición de un subrayado como una
entrada nueva: se conserva la última, y los comentarios se unen a su subrayado.

Kindle no guarda el capítulo de cada subrayado. FastRead lo deduce buscando la cita dentro
del libro: en el propio Kindle o en las carpetas de tus libros recientes. Necesita el libro
en EPUB o MOBI sin protección (no sirve con los comprados en Amazon) y con índice.

## Comandos

```sh
cd src-tauri
cargo tauri dev     # abrir en modo desarrollo (recarga al editar ui/)
cargo tauri build   # crear FastRead.app y el .dmg en src-tauri/target/release/bundle/
```

## Pruebas

```sh
./test.sh
```

Corre las pruebas de Rust (`cargo test`) y las de la interfaz (`node --test`, sin instalar
nada más). Conviene correrlas antes de cada commit.

Cada parte tiene su carpeta de pruebas:

- `src-tauri/tests/`: una prueba por archivo de `src-tauri/src` (book.rs, kobo.rs, chapters.rs).
  Cada archivo de código termina con `mod tests`, que apunta a su prueba; así las pruebas
  pueden usar funciones internas. Sus archivos de prueba están en `src-tauri/tests/resources/`:
  el contenido de un EPUB (`libro-de-prueba/`, que las pruebas comprimen), sus variantes de
  `content.opf` (`opf/`) y una base de datos de Kobo (`kobo.sql`).
- `ui-tests/`: pruebas de la interfaz (`*.test.js`). Están fuera de `ui/` para que no se
  empaqueten dentro de la app. `load-ui.js` carga los archivos de `ui/` en un entorno
  simulado (sin navegador ni Tauri) para probar sus funciones. Sus archivos de prueba
  (un `My Clippings.txt` de Kindle y una nota existente de Obsidian) están en `ui-tests/resources/`.

## Dónde está cada cosa

| Archivo | Qué hace |
|---|---|
| `ui/index.html` | Estructura de la ventana, ayuda de atajos y editor de subrayados |
| `ui/style.css` | Temas de color, tamaños, tipografía |
| `ui/app.js` | Lectura, vistas (lector y texto completo), índice, ajustes y teclado |
| `ui/rhythm.js` | Cuánto dura cada palabra (pausas, ritmo natural) y qué es diálogo |
| `ui/notes.js` | Subrayados: modo subrayado, editor y archivos para Obsidian |
| `ui/import.js` | Importar subrayados de Kindle (My Clippings.txt) y Kobo |
| `ui/menu.js` | Menú principal y libros recientes |
| `src-tauri/src/book.rs` | Lee EPUB/MOBI: palabras, párrafos, índice, título y autor |
| `src-tauri/src/kobo.rs` | Lee los subrayados de la base de datos de un Kobo |
| `src-tauri/src/chapters.rs` | Busca en qué capítulo de un libro está cada cita (para Kindle) |
| `src-tauri/src/main.rs` | Arranca la app; comandos `open_book`, `kobo_highlights`, `find_chapters`, `read_text`, `write_text` |

Cambios fáciles:

- Pausas y tiempos del cambio de capítulo: valores al inicio de `ui/rhythm.js`.
- Un tema nuevo: 6 colores en `ui/style.css` y una línea en `THEMES` (`ui/app.js`).
- Tamaño de la palabra: `#word` en `ui/style.css`. Rango de velocidad: `index.html` (`min`/`max`) y `setWpm()`.

## Nota sobre permisos de macOS

La primera vez que FastRead abre un libro de la carpeta Documentos, macOS pide permiso.
Con cada nueva compilación (`cargo tauri build`) macOS la considera una app distinta y
vuelve a preguntar.
