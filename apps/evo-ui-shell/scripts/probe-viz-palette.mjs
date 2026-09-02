// Driven verification for the visualizer PALETTE + COLOUR MODE axis.
// Runs against the LIVE rig designer (not a local dist): clicks the
// studio dials, confirms the device settings PATCH round-trips, and
// samples the preview canvas pixels to prove multi-hue rendering is
// actually happening (chrome evidence alone is not rendering
// evidence).
//
// Usage: node scripts/probe-viz-palette.mjs <RIG_BASE> <OUT_DIR>
//   e.g. node scripts/probe-viz-palette.mjs http://192.0.2.24 /tmp
// where <RIG_BASE> is the http origin of the operator's target
// device. RFC 5737 TEST-NET-1 is used in the example so this
// script never carries a routable default; supply the real
// origin at the command line.

import { chromium } from "playwright-core";
import { snapshotSettings, restoreSettings } from "./probe-lib.mjs";

const BASE = process.argv[2] || "http://192.0.2.24";
const OUT = process.argv[3] || "/tmp";
const EXE = process.env.PW_EXE;

// Probe hygiene: capture the device settings this probe can touch;
// restore them at the end even on failure.
const __snap = await snapshotSettings(BASE, ["ui.visualizer.palette", "ui.visualizer.color_mode", "ui.visualizer.preset"]);
process.on("beforeExit", () => { /* sync guard only */ });

const fail = async (msg) => { console.error(`FAIL: ${msg}`); try { await restoreSettings(BASE, __snap); } catch {} process.exit(1); };
const ok = (msg) => console.log(`PASS: ${msg}`);

async function settings() {
  const r = await fetch(`${BASE}/api/ui/v1/settings`);
  const j = await r.json();
  return j.settings ?? j;
}

/** Count distinct coarse hues on the preview canvas. */
async function hueCount(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector(".viz-studio-panel canvas");
    if (!canvas) return -1;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height).data;
    const hues = new Set();
    for (let i = 0; i < img.length; i += 4 * 97) { // stride-sample
      const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
      if (a < 40) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 24) continue; // greys don't count as hues
      let h;
      if (mx === r) h = ((g - b) / (mx - mn)) % 6;
      else if (mx === g) h = (b - r) / (mx - mn) + 2;
      else h = (r - g) / (mx - mn) + 4;
      hues.add(Math.round(((h * 60 + 360) % 360) / 30)); // 12 buckets
    }
    return hues.size;
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
// networkidle never settles here - the shell keeps the settings
// long-poll open by design. DOM readiness + explicit selector waits.
await page.goto(`${BASE}/?designer=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".designer-topbar, .designer-tabs", { timeout: 15000 });

// 1. Enter the Visualizer studio.
await page.getByRole("tab", { name: "Visualizer" }).or(page.getByText("Visualizer", { exact: true })).first().click();
await page.waitForSelector(".viz-studio", { timeout: 5000 });
ok("studio open");

// 2. Palette segment renders all 7 chips with swatches.
const palBtns = page.locator(".viz-palette-seg button");
const nPal = await palBtns.count();
if (nPal !== 7) fail(`palette chips: expected 7, got ${nPal}`);
const nSwatch = await page.locator(".viz-palette-seg .viz-palette-swatch").count();
if (nSwatch !== 7) fail(`swatches: expected 7, got ${nSwatch}`);
ok("7 palettes, 7 swatches");

// 3. Pick Prism -> device PATCH round-trip.
await palBtns.filter({ hasText: "Prism" }).click();
await page.waitForTimeout(900);
let s = await settings();
if (s["ui.visualizer.palette"] !== "prism") fail(`device palette = ${s["ui.visualizer.palette"]}`);
ok("ui.visualizer.palette = prism on the device");

// 4. Pick Frequency mode -> round-trip.
await page.locator(".stb-seg button", { hasText: "Frequency" }).click();
await page.waitForTimeout(900);
s = await settings();
if (s["ui.visualizer.color_mode"] !== "frequency") fail(`device color_mode = ${s["ui.visualizer.color_mode"]}`);
ok("ui.visualizer.color_mode = frequency on the device");

// 5. Pixel evidence: prism+frequency must paint many distinct hues.
await page.waitForTimeout(600);
const huesPrism = await hueCount(page);
if (huesPrism < 4) fail(`prism/frequency hue buckets = ${huesPrism} (< 4)`);
ok(`prism/frequency paints ${huesPrism} hue buckets`);
await page.screenshot({ path: `${OUT}/viz-palette-prism-frequency.png` });

// 5b. VERTICAL progression: fluid + prism + GRADIENT must also paint
// many distinct hues - the shared full-travel gradient reveals every
// stop along each line's height.
await page.locator(".stb-seg button", { hasText: "fluid" }).first().click();
await page.waitForTimeout(300);
await page.locator(".stb-seg button", { hasText: "Gradient" }).first().click();
await page.waitForTimeout(900);
s = await settings();
if (s["ui.visualizer.color_mode"] !== "gradient") fail(`device color_mode = ${s["ui.visualizer.color_mode"]}`);
const huesVertical = await hueCount(page);
if (huesVertical < 4) fail(`prism/gradient (vertical) hue buckets = ${huesVertical} (< 4)`);
ok(`prism/gradient paints ${huesVertical} hue buckets vertically on fluid`);
await page.screenshot({ path: `${OUT}/viz-fluid-prism-gradient.png` });

// 6. Revert to Theme + Gradient (legacy paint) and confirm.
await palBtns.filter({ hasText: "Theme" }).click();
await page.waitForTimeout(400);
await page.locator(".stb-seg button", { hasText: "Gradient" }).first().click();
await page.waitForTimeout(900);
s = await settings();
if (s["ui.visualizer.palette"] !== "theme") fail(`revert palette = ${s["ui.visualizer.palette"]}`);
if (s["ui.visualizer.color_mode"] !== "gradient") fail(`revert color_mode = ${s["ui.visualizer.color_mode"]}`);
const huesTheme = await hueCount(page);
ok(`reverted to theme/gradient (hue buckets now ${huesTheme})`);
await page.screenshot({ path: `${OUT}/viz-palette-theme-gradient.png` });

await browser.close();
const __r = await restoreSettings(BASE, __snap);
if (__r.restored) console.log("hygiene: restored", __r.keys.join(","));
console.log("ALL PASS");
