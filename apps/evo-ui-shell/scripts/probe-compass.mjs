// Driven verification for COMPASS CURATION. Against the LIVE rig
// designer: selects a compact (pivot) screen, exercises the editor -
// slot reassignment reflected LIVE in the embedded preview iframe,
// the Now-playing lock refusal, Apply round-trip into ui.profile,
// and the two-step reset leaving the stored data clean.
//
// Usage: node scripts/probe-compass.mjs <RIG_BASE> <OUT_DIR>
//   e.g. node scripts/probe-compass.mjs http://192.0.2.24 /tmp
// RFC 5737 TEST-NET-1 is used in the example so this script
// never carries a routable default; supply the real origin at
// the command line.

import { chromium } from "playwright-core";
import { snapshotSettings, restoreSettings } from "./probe-lib.mjs";

const BASE = process.argv[2] || "http://192.0.2.24";
const OUT = process.argv[3] || "/tmp";
const EXE = process.env.PW_EXE;

// Probe hygiene: capture the device settings this probe can touch;
// restore them at the end even on failure.
const __snap = await snapshotSettings(BASE, ["ui.profile", "ui.display.native_target"]);
process.on("beforeExit", () => { /* sync guard only */ });

const fail = async (msg) => { console.error(`FAIL: ${msg}`); try { await restoreSettings(BASE, __snap); } catch {} process.exit(1); };
const ok = (msg) => console.log(`PASS: ${msg}`);

async function uiProfile() {
  const r = await fetch(`${BASE}/api/ui/v1/settings`);
  const j = await r.json();
  const s = j.settings ?? j;
  return s["ui.profile"] ?? null;
}
function findCompassOverride(profile) {
  if (profile == null) return null;
  for (const p of Object.values(profile.byTarget ?? {})) {
    if (p && typeof p === "object" && p.compass) return p.compass;
  }
  return profile.custom?.compass ?? null;
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(`${BASE}/?designer=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".designer-topbar, .designer-tabs", { timeout: 15000 });

// 1. Pick a compact screen (pivot interaction) via Change:
// resolution-first flow - 480x272 wearable, then its 4.3in size.
await page.getByText("Change", { exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByText("480x272", { exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByText("4.3in", { exact: true }).first().click();
await page.waitForTimeout(800);
ok("compact screen selected (480x272 wearable, 4.3in)");

// 2. Home tab -> compass editor with 5 gesture cards.
await page.locator(".designer-tabs button", { hasText: "Home" }).first().click();
await page.waitForSelector(".designer-compass", { timeout: 5000 });
const cards = page.locator(".compass-slot-card");
if ((await cards.count()) !== 5) fail(`slot cards: ${await cards.count()} != 5`);
ok("compass editor open, 5 gesture cards");
await page.screenshot({ path: `${OUT}/compass-editor-outline.png` });

// 2b. Landing -> Compass home (this target had Track home stored),
// so the preview rests on the anchor and the chevrons are visible.
await page.locator(".designer-compass .stb-seg button", { hasText: "Compass home" }).click();
await page.waitForTimeout(600);
ok("landing set to compass home via the editor");

// 3. Now-playing lock: open Swipe up (the only track slot) - every
// other action must be disabled with the reason.
await page.locator('[data-compass-slot="up"]').click();
await page.waitForSelector(".designer-compass .stb-seg");
const disabledCount = await page
  .locator(".designer-compass .stb-seg button[disabled]")
  .count();
if (disabledCount !== 5) fail(`lock: expected 5 disabled options, got ${disabledCount}`);
ok("Now-playing lock refuses reassignment of the last track slot");
await page.locator(".designer-compass .stb-back").click();
await page.waitForSelector(".compass-slot-card");

// 4. Reassign Swipe right -> Queue; the embedded preview must update.
await page.locator('[data-compass-slot="right"]').click();
await page.waitForSelector(".designer-compass .stb-seg");
await page.locator(".designer-compass .stb-seg button", { hasText: "Queue" }).click();
await page.waitForTimeout(600);
const frame = page.frameLocator("iframe.designer-device-screen");
const rightLabel = await frame
  .locator(".pivot-direction-right")
  .getAttribute("aria-label")
  .catch(() => null);
if (rightLabel !== "Queue") fail(`live preview right chevron aria-label = ${rightLabel}`);
ok("live preview: right chevron now opens Queue");
await page.screenshot({ path: `${OUT}/compass-right-queue.png` });

// 5. Apply -> ui.profile carries the override.
await page.locator(".designer-apply-btn-bar").click();
await page.waitForTimeout(1200);
let override = findCompassOverride(await uiProfile());
if (!override || override.right !== "library") {
  fail(`applied override = ${JSON.stringify(override)}`);
}
ok("Apply round-trip: ui.profile compass override = { right: library }");

// 6. Reset to classic (two-step) -> override gone after Apply.
// The editor may still sit in the slot settings view - back out.
if ((await page.locator(".compass-slot-card").count()) !== 5) {
  await page.locator(".designer-compass .stb-back").click();
  await page.waitForSelector(".compass-slot-card");
}
const reset = page.getByText("Reset to classic", { exact: false }).first();
await reset.click();
await page.getByText("Tap again to reset", { exact: false }).first().click();
await page.waitForTimeout(400);
await page.locator(".designer-apply-btn-bar").click();
await page.waitForTimeout(1200);
override = findCompassOverride(await uiProfile());
if (override !== null) fail(`after reset, override = ${JSON.stringify(override)}`);
ok("reset to classic: stored compass override removed");

await browser.close();
const __r = await restoreSettings(BASE, __snap);
if (__r.restored) console.log("hygiene: restored", __r.keys.join(","));
console.log("ALL PASS");
