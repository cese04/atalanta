#!/bin/sh
# Corre todas las pruebas: las de Rust (lectura de libros, Kobo, capítulos de Kindle)
# y las de la interfaz (ritmo, diálogos, notas, importación). Se detiene al primer fallo.
set -e
cd "$(dirname "$0")"
echo "── Rust ──"
(cd src-tauri && cargo test --quiet)
echo "── Interfaz ──"
node --test "ui-tests/*.test.js"
