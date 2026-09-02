// Generate GTK3-safe squeekboard CSS packs from the five shipped UI themes.
//
// Source of truth: the `.theme-{id}` token blocks in src/styles.css (the SAME
// tokens the app UI uses). This is a mechanical export, not a second design
// pass - no new tokens, no parallel OSK palette. oklch(...) is converted to
// sRGB hex at generate time because GTK3 CSS does not understand oklch.
//
// Output: public/osk/gtk/{id}.css  ->  ships verbatim into
// dist/osk/gtk/{id}.css  ->  /opt/evo/ui/current/osk/gtk/{id}.css on device.
//
// The generated files are COMMITTED artefacts (the kiosk host must not need
// Node at boot). Regenerate whenever the theme tokens change:
//   node scripts/gen-osk-themes.mjs
//
// Token -> squeekboard mapping (fixed, per the UI/Framework handoff contract):
//   --background            -> view (window/.keyboard) background
//   --secondary             -> key face (button) background
//   --card-foreground       -> key label colour
//   --border                -> key border
//   --primary               -> pressed key + special/altline/wide keys
//   --primary-foreground    -> label on pressed/special keys

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL = join(HERE, "..");
const STYLES = join(SHELL, "src", "styles.css");
const OUT_DIR = join(SHELL, "public", "osk", "gtk");

const THEME_IDS = ["evo-default", "night-sky", "sunrise", "air", "liquid"];

// --- oklch -> sRGB hex ------------------------------------------------------
// oklch -> oklab -> linear sRGB (Bjorn Ottosson matrices) -> gamma -> hex.
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toSrgb = (c) => {
    const cl = Math.min(1, Math.max(0, c));
    const v = cl <= 0.0031308 ? 12.92 * cl : 1.055 * cl ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const hex = (n) => n.toString(16).padStart(2, "0");
  return `#${hex(toSrgb(rLin))}${hex(toSrgb(gLin))}${hex(toSrgb(bLin))}`;
}

// --- parse the .theme-{id} blocks from styles.css --------------------------
function parseThemeTokens(css, id) {
  const re = new RegExp(`\\.theme-${id}\\s*\\{([^}]*)\\}`);
  const block = css.match(re);
  if (block === null) throw new Error(`.theme-${id} block not found`);
  const tokens = {};
  const tokenRe = /--([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  let m;
  while ((m = tokenRe.exec(block[1])) !== null) {
    tokens[m[1]] = oklchToHex(Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return tokens;
}

function pack(id, tk) {
  const need = [
    "background",
    "secondary",
    "card-foreground",
    "border",
    "primary",
    "primary-foreground"
  ];
  for (const k of need) {
    if (tk[k] === undefined) throw new Error(`${id}: missing --${k}`);
  }
  return `/* Evo on-screen keyboard theme: ${id}
 * GENERATED from the .theme-${id} tokens in src/styles.css (oklch -> sRGB hex).
 * DO NOT EDIT BY HAND - run: node scripts/gen-osk-themes.mjs
 * squeekboard reads this via the kiosk user's ~/.config/gtk-3.0/gtk.css. */

window,
.keyboard {
  background-color: ${tk["background"]};
}

button {
  background-color: ${tk["secondary"]};
  color: ${tk["card-foreground"]};
  border: 1px solid ${tk["border"]};
}

button:active,
button:checked {
  background-color: ${tk["primary"]};
  color: ${tk["primary-foreground"]};
}

button.special,
button.altline,
button.wide {
  background-color: ${tk["primary"]};
  color: ${tk["primary-foreground"]};
}
`;
}

const css = readFileSync(STYLES, "utf8");
mkdirSync(OUT_DIR, { recursive: true });
const summary = [];
for (const id of THEME_IDS) {
  const tk = parseThemeTokens(css, id);
  writeFileSync(join(OUT_DIR, `${id}.css`), pack(id, tk));
  summary.push(
    `${id}: view=${tk["background"]} key=${tk["secondary"]} label=${tk["card-foreground"]} accent=${tk["primary"]} border=${tk["border"]}`
  );
}
console.log(`Wrote ${THEME_IDS.length} packs to ${OUT_DIR}`);
console.log(summary.join("\n"));
