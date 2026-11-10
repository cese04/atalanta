// Pruebas de ui/style.css: cada tema de color se lee bien (contraste WCAG AA).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "ui", "style.css"), "utf8");

// Contraste entre dos colores #rrggbb, como lo define WCAG: de 1 (igual) a 21 (negro y blanco).
function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const themes = [...css.matchAll(/\[data-theme="([^"]+)"\] \{([^}]*)\}/g)].map(([, name, body]) => {
  const color = (key) => body.match(new RegExp(`--${key}: (#[0-9a-f]{6})`))[1];
  return { name, bg: color("bg"), fg: color("fg"), muted: color("muted"), accent: color("accent"), error: color("error"), track: color("track") };
});

test("hay temas que revisar", () => {
  assert.ok(themes.length >= 12);
});

// Texto, texto secundario y errores: 4.5:1. Acento (letra ancla, capítulo actual, anillo de foco) y
// líneas de los controles: 3:1.
for (const t of themes) {
  test(`contraste del tema ${t.name}`, () => {
    assert.ok(contrast(t.fg, t.bg) >= 4.5, `texto ${contrast(t.fg, t.bg).toFixed(2)}`);
    assert.ok(contrast(t.muted, t.bg) >= 4.5, `secundario ${contrast(t.muted, t.bg).toFixed(2)}`);
    assert.ok(contrast(t.error, t.bg) >= 4.5, `error ${contrast(t.error, t.bg).toFixed(2)}`);
    assert.ok(contrast(t.accent, t.bg) >= 3, `acento ${contrast(t.accent, t.bg).toFixed(2)}`);
    assert.ok(contrast(t.track, t.bg) >= 3, `controles ${contrast(t.track, t.bg).toFixed(2)}`);
  });
}
