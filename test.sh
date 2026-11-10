#!/bin/sh
# Corre todas las pruebas: las de Rust (core: libros, ritmo, notas, Kindle, Kobo, PDF)
# y las de la interfaz (ui-tests). Se detiene al primer fallo.
set -e
cd "$(dirname "$0")"
echo "── Rust ──"
cargo test -p atalanta-core --quiet
echo "── Interfaz ──"
node --test ui-tests/*.test.js
