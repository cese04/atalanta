# FastRead

Lector veloz (palabra por palabra) para libros `.epub`, `.mobi` y `.pdf`, hecho con Rust + Tauri.
Al pausar muestra el texto completo, donde puedes elegir desde dónde seguir y subrayar
fragmentos que se guardan como notas Markdown para Obsidian.

## Usar

- **Archivo › Abrir…** (⌘O) o **Abrir reciente**. Al iniciar se ve la pantalla de inicio,
  con el último libro y los demás recientes; `Espacio` o `Enter` retoman el último donde lo dejaste.
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
| ⌘+ ⌘− ⌘0 | Letra más grande / más pequeña / normal (toda la interfaz escala junta) |

## PDF

Los PDF se leen con pdf.js, dentro de la interfaz (igual en macOS, Windows y Linux). Un PDF
solo dice qué texto va en qué posición, así que FastRead reconstruye el libro: une renglones
en párrafos, une palabras partidas con guion, quita encabezados, números de página y notas al
pie, detecta títulos por su tamaño de letra y toma el índice de los marcadores del PDF.
Funciona bien con prosa; las fórmulas matemáticas no se pueden leer palabra por palabra.
Los PDF escaneados (sin texto) aún no se leen.

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

Cada libro que abres tiene su nota, aunque no tenga subrayados, con propiedades de lectura que
Obsidian (Bases o Dataview) puede reunir en una tabla. Las que añadas tú se conservan.

| Propiedad | Valor | Cuándo cambia |
|---|---|---|
| `progress` | % leído (0–100) | en cada pausa y al cambiar de libro |
| `wpm` | velocidad (palabras por minuto) | en cada pausa |
| `started` | fecha en que abriste el libro por primera vez | una sola vez |
| `finished` | fecha en que llegaste al final | una sola vez |
| `cover` | enlace a la portada, guardada en `portadas/` | al abrir el libro |

La portada (de los metadatos del EPUB o MOBI, o la primera página de un PDF) se ve al
principio del texto en la pausa y en el panel del índice (Ver › Portada en el índice), y se
guarda como miniatura en `portadas/` dentro de la carpeta de notas. Con una Base de Obsidian
en vista de tarjetas, las notas de tus libros se ven con su portada.

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
cargo tauri build   # crear FastRead.app y el .dmg en target/release/bundle/
```

### Windows y Linux

GitHub Actions (`.github/workflows/ci.yml`) corre las pruebas y compila la app en cada push a
`main`. Los instaladores quedan en la página del run (pestaña **Actions**, sección
*Artifacts*) durante 14 días:

- `FastRead-Windows`: instalador `FastRead_…_x64-setup.exe` y `fastread.exe`, que corre sin
  instalar. No están firmados: Windows avisa la primera vez (**Más información › Ejecutar de
  todas formas**).
- `FastRead-Linux`: `.deb` (Ubuntu, Debian) y `.AppImage` (cualquier distribución:
  `chmod +x` y abrirlo).

## Pruebas

```sh
./test.sh
```

Corre las pruebas de Rust (`cargo test -p fastread-core`) y las de la interfaz (`node --test`,
sin instalar nada más). Conviene correrlas antes de cada commit.

Cada parte tiene su carpeta de pruebas:

- `core/tests/`: una prueba por archivo de `core/src`. Cada archivo de código termina con
  `mod tests`, que apunta a su prueba; así las pruebas pueden usar funciones internas. Sus
  archivos de prueba están en `core/tests/resources/`: el contenido de un EPUB
  (`libro-de-prueba/`, que las pruebas comprimen), sus variantes de `content.opf` (`opf/`),
  una base de datos de Kobo (`kobo.sql`), un `My Clippings.txt` de Kindle, una nota existente
  de Obsidian y los renglones de un PDF de ejemplo (`pdf-paginas.json`).
- `ui-tests/`: pruebas de lo que queda en la interfaz (`*.test.js`). Están fuera de `ui/` para
  que no se empaqueten dentro de la app. `load-ui.js` carga los archivos de `ui/` en un
  entorno simulado (sin navegador ni Tauri) para probar sus funciones.

## Dónde está cada cosa

El proyecto es un *workspace* de Cargo con dos crates: **`core`**, toda la lógica sin interfaz
(se puede reutilizar con otra interfaz), y **`src-tauri`**, la app, que solo conecta `core`
con la interfaz web de `ui/` mediante comandos.

| Archivo | Qué hace |
|---|---|
| `ui/index.html` | Estructura de la ventana, ayuda de atajos y editor de subrayados |
| `ui/style.css` | Temas de color, tamaños, tipografía |
| `ui/app.js` | Lectura, vistas (lector y texto completo), índice, ajustes y teclado |
| `ui/pdf-reader.js` | Saca con pdf.js (`ui/vendor/pdfjs`) los renglones, marcadores y portada de un PDF |
| `ui/rhythm.js` | Tiempo de cada palabra a la velocidad elegida, arranque gradual y dónde seguir al reanudar |
| `ui/notes.js` | Subrayados: modo subrayado, editor, sus datos y las propiedades de lectura que se piden |
| `ui/import.js` | Elegir los archivos de Kindle y Kobo y avisar del resultado de la importación |
| `ui/menu.js` | Menú principal y libros recientes |
| `core/src/book.rs` | Lee EPUB/MOBI: palabras, párrafos, formato, índice, título, autor y resumen |
| `core/src/pdf.rs` | Reconstruye un libro a partir de los renglones de un PDF |
| `core/src/rhythm.rs` | Pausa de cada palabra (ritmo natural), diálogo y separadores de sección |
| `core/src/notes.rs` | Notas de Obsidian: secciones, resumen, propiedades y nombres de archivo |
| `core/src/kindle.rs` | Lee e importa My Clippings.txt de un Kindle |
| `core/src/kobo.rs` | Lee e importa los subrayados de la base de datos de un Kobo |
| `core/src/chapters.rs` | Busca en qué capítulo de un libro está cada cita (para Kindle) |
| `core/src/cover.rs` | Extrae la portada de un EPUB o MOBI |
| `src-tauri/src/main.rs` | Arranca la app y expone `core` a la interfaz como comandos (`open_book`, `pdf_book`, `notes_*`, `import_*`…) |

Cambios fáciles:

- Pausas de cada palabra (ritmo natural): constantes `PAUSE_*` al inicio de `core/src/rhythm.rs`.
- Tiempos del cambio de capítulo, del parpadeo y al reanudar: valores al inicio de `ui/rhythm.js`.
- Un tema nuevo: 6 colores en `ui/style.css` y una línea en `THEMES` (`ui/app.js`).
- Tamaño de la palabra: `#word` en `ui/style.css`. Rango de velocidad: `index.html` (`min`/`max`) y `setWpm()`.

## Créditos

- Fuentes incluidas en `ui/fonts`, cada una con su licencia:
  - **ET Book** (Dmitry Krasny, Bonnie Scranton y Edward Tufte): licencia MIT.
  - **Atkinson Hyperlegible** (Braille Institute): SIL Open Font License 1.1.
  - **iA Writer Quattro** (Information Architects, basada en IBM Plex): SIL Open Font License 1.1.
- Iowan Old Style, New York, Charter y San Francisco son fuentes del sistema macOS.
- **pdf.js** (Mozilla), en `ui/vendor/pdfjs`: licencia Apache 2.0.
- Temas de color basados en Tufte CSS, Solarized, Catppuccin, Gruvbox, Nord, Dracula y
  obsidian-typewriter.

## Nota sobre permisos de macOS

La primera vez que FastRead abre un libro de la carpeta Documentos, macOS pide permiso.
Con cada nueva compilación (`cargo tauri build`) macOS la considera una app distinta y
vuelve a preguntar.
