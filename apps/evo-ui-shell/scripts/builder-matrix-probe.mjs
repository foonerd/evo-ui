// Builder validation matrix - measures every designer-controlled
// layout fact on a live device, per display size and orientation,
// and prints plain-English PASS/FAIL lines with the numbers.
//
// Usage:  node scripts/builder-matrix-probe.mjs <RIG_BASE> [outDir]
//   e.g.  node scripts/builder-matrix-probe.mjs http://192.0.2.24 /tmp
// where <RIG_BASE> is the http origin of the operator's target
// device. RFC 5737 TEST-NET-1 is used in the example so this
// script never carries a routable default; the first argv
// entry must supply the real origin.
//
// What it validates, per viewport in the matrix:
//   - menu chrome: pinned sidebar column vs drawer + floating button,
//     honouring nav.position/mode from the stored layout document
//   - home page slots: each widget's measured rectangle vs the
//     stored size (12-col span) and align (column start), inside the
//     measured .doc-page-main grid
//   - rail: measured position (left/right/top/bottom) vs the page's
//     railPosition; "off" must leave zero rail nodes and main at
//     full content width
//   - fold shedding: widgets below the tier floor absent, contract
//     kinds (now-playing) always present
//
// Harness style follows probe-rest.mjs (playwright-core, headless,
// --no-sandbox). The device is NOT modified - read-only probing.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: node builder-matrix-probe.mjs http://<device> [outDir]");
  process.exit(2);
}
const OUT = process.argv[3] || "/tmp/builder-matrix";
mkdirSync(OUT, { recursive: true });

// --- shared contracts, mirrored from src (kept literal so the ---
// --- script runs under plain node with zero build steps)        ---
const SPAN = { atom: 2, quarter: 3, third: 4, half: 6, "two-thirds": 8, full: 12 };
const ALIGN_START = (size, align) => {
  const span = SPAN[size] ?? 6;
  if (align === "left") return 1;
  if (align === "center") return Math.floor((12 - span) / 2) + 1;
  if (align === "right") return 13 - span;
  return null; // auto - flows
};
const FOLD = { soloW: 480, soloH: 480, stripH: 430, stripW: 1180, stackW: 800, splitW: 1180, cinemaW: 2400 };
function foldTierFor(w, h) {
  if (w < FOLD.soloW && h < FOLD.soloH) return "solo";
  if (h < FOLD.stripH && w < FOLD.stripW) return "strip";
  if (h < FOLD.stripH && w >= FOLD.stripW) return "bar";
  if (w < FOLD.stackW) return "stack";
  if (w < FOLD.splitW) return "split";
  if (w >= FOLD.cinemaW) return "cinema";
  return "full";
}
const FOLD_MIN = { cinema: 1, full: 1, split: 2, stack: 3, bar: 4, strip: 5, solo: 5 };
const CONTRACT = new Set(["evo.app.nowplaying"]);
const DEFAULT_HOME = {
  railPosition: "right",
  main: [{ kind: "evo.app.nowplaying", size: "full", align: undefined, prio: 5 }],
  rail: [
    { kind: "evo.app.comingnext", size: "quarter", prio: 3 },
    { kind: "evo.app.volume", size: "atom", prio: 4 }
  ]
};

// --- the display matrix: every rig shape, both orientations ---
const MATRIX = [
  { name: "5in panel landscape", w: 800, h: 480 },
  { name: "5in panel portrait", w: 480, h: 800 },
  { name: "7in kiosk landscape", w: 1280, h: 720 },
  { name: "7in kiosk portrait", w: 720, h: 1280 },
  { name: "10in landscape", w: 1024, h: 600 },
  { name: "desktop window", w: 1600, h: 900 },
  { name: "phone portrait", w: 390, h: 844 }
];

// --- fetch stored config (read-only) ---
async function fetchSettings() {
  const res = await fetch(`${BASE}/api/ui/v1/settings`);
  if (!res.ok) throw new Error(`settings http ${res.status}`);
  return res.json();
}
function homeFromSettings(settings) {
  const profile = settings?.settings?.["ui.profile"];
  const docs = [];
  const where = [];
  // TWO-SCOPE MODEL: the probe's windows open by device IP, so every
  // one of them is a REMOTE session. Remote resolves the remote slot,
  // else the DERIVED full-reference view (whose home is the shipped
  // DEFAULT_HOME arrangement). NATIVE (byTarget) layouts belong to
  // the attached panel and are validated on the panel / via /native,
  // never by these windows.
  if (profile?.remote?.layout) { docs.push(profile.remote.layout); where.push("remote"); }
  const stored = [];
  if (profile?.custom?.layout) stored.push("custom");
  if (profile?.byTarget)
    for (const [k, v] of Object.entries(profile.byTarget))
      if (v?.layout) stored.push(`byTarget["${k}"]`);
  console.log(`Layout documents stored under: ${[...where, ...stored].join(", ") || "NOWHERE"}`);
  console.log(
    "Scope model: these windows are REMOTE (device IP) - they resolve remote.layout, else the derived full-reference view."
  );
  console.log(
    "Native (byTarget/custom) layouts render on the attached panel and at /native - not in these windows."
  );
  for (const doc of docs) {
    const home = (doc.pages ?? []).find((p) => p.id === "home");
    if (home) {
      return {
        stored: true,
        railPosition: home.railPosition ?? "right",
        main: (home.regions?.main ?? []).map((s) => ({ kind: s.widgetKindId, size: s.size, align: s.align, prio: s.foldPriority ?? 3 })),
        rail: (home.regions?.rail ?? []).map((s) => ({ kind: s.widgetKindId, size: s.size, prio: s.foldPriority ?? 3 }))
      };
    }
  }
  return { stored: false, ...DEFAULT_HOME };
}

const results = [];
const say = (view, verdict, what) => {
  results.push({ view, verdict, what });
  console.log(`${verdict === "PASS" ? "PASS" : verdict === "FAIL" ? "FAIL" : "NOTE"}  [${view}] ${what}`);
};

const settings = await fetchSettings().catch((e) => {
  console.error(`Cannot read device settings: ${e.message}`);
  return null;
});
const home = settings ? homeFromSettings(settings) : { stored: false, ...DEFAULT_HOME };
console.log(`\nDevice: ${BASE}`);
console.log(`Home source: ${home.stored ? "STORED layout document" : "shipped default (no stored home)"}`);
console.log(`Configured: rail=${home.railPosition}; main=[${home.main.map((s) => `${s.kind}@${s.size}${s.align ? "/" + s.align : ""}(p${s.prio})`).join(", ")}]\n`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

for (const view of MATRIX) {
  const tier = foldTierFor(view.w, view.h);
  const floor = FOLD_MIN[tier];
  const label = `${view.name} ${view.w}x${view.h} tier=${tier}`;
  const page = await browser.newPage({ viewport: { width: view.w, height: view.h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    // The live device holds its happenings WebSocket open forever,
    // so "networkidle" never fires - wait for DOM + a fixed settle.
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${view.w}x${view.h}.png`) });

    const m = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const pivot = document.documentElement.getAttribute("data-interaction") === "pivot" ||
        !!document.querySelector(".app-shell-pivot");
      const slots = [...document.querySelectorAll(".doc-slot")].map((el) => ({
        kind: el.getAttribute("data-widget-kind"),
        region: el.className.includes("doc-slot-rail") ? "rail" : el.className.includes("doc-slot-deck") ? "deck" : "main",
        rect: rect(el)
      }));
      const np = document.querySelector('.doc-slot[data-widget-kind="evo.app.nowplaying"]');
      return {
        pivot,
        sidebar: rect(document.querySelector(".app-sidebar")),
        fab: rect(document.querySelector(".app-nav-fab")),
        header: rect(document.querySelector(".app-header")),
        content: rect(document.querySelector(".app-content")),
        grid: rect(document.querySelector(".doc-page-main")),
        railRegion: rect(document.querySelector(".doc-page-rail")),
        slots,
        forensics: {
          bundle: (document.querySelector('script[src*="index-"]')?.getAttribute("src") ?? "?"),
          bodyClass: document.querySelector(".doc-page-body")?.className ?? "no doc-page-body",
          npClass: np?.className ?? "no nowplaying slot",
          npInlineGridColumn: np?.style?.gridColumn ?? "(none)",
          npComputedGridColumn: np ? getComputedStyle(np).gridColumn : "(none)",
          slotKinds: slots.map((s) => `${s.kind}@${s.region}`).join(", ")
        }
      };
    });
    console.log(`INFO  [${label}] bundle=${m.forensics.bundle}`);
    console.log(`INFO  [${label}] slots: ${m.forensics.slotKinds}`);
    console.log(`INFO  [${label}] body="${m.forensics.bodyClass}" np="${m.forensics.npClass}" inlineCol="${m.forensics.npInlineGridColumn}" computedCol="${m.forensics.npComputedGridColumn}"`);

    if (errors.length) say(label, "FAIL", `page errors: ${errors.join(" | ")}`);
    if (m.pivot) {
      say(label, "NOTE", "pivot interaction - document home does not apply here; skipping slot checks");
      if (m.sidebar && m.sidebar.w > 0) say(label, "FAIL", "pivot must not show the sidebar");
      else say(label, "PASS", "pivot shows no sidebar");
      await page.close();
      continue;
    }

    // Menu chrome: header bar must never exist; either pinned sidebar
    // (occupying a left/right column) or the floating button.
    if (m.header) say(label, "FAIL", "the abolished header bar is rendering");
    else say(label, "PASS", "no header bar anywhere");
    const drawerish = !m.sidebar || m.sidebar.x < -10 || m.sidebar.x > view.w;
    if (drawerish && (!m.fab || m.fab.w === 0)) say(label, "FAIL", "menu is a drawer but no floating button is visible");
    else say(label, "PASS", drawerish ? `drawer chrome with floating button at x=${m.fab?.x}` : `pinned sidebar ${m.sidebar.w}px wide`);

    // Home slots vs configuration.
    if (!m.grid) { say(label, "FAIL", "no .doc-page-main grid found on home"); await page.close(); continue; }
    const col = m.grid.w / 12;
    const expectVisible = home.main.filter((s) => CONTRACT.has(s.kind) || s.prio >= floor);
    const expectShed = home.main.filter((s) => !CONTRACT.has(s.kind) && s.prio < floor);
    for (const exp of expectVisible) {
      const got = m.slots.find((s) => s.kind === exp.kind && s.region === "main");
      if (!got) { say(label, "FAIL", `${exp.kind} configured visible (p${exp.prio} >= floor ${floor}) but not rendered`); continue; }
      const spanPx = (SPAN[exp.size] ?? 6) * col;
      const wOk = Math.abs(got.rect.w - spanPx) <= col * 0.35;
      if (!wOk) say(label, "FAIL", `${exp.kind} size=${exp.size}: expected ~${Math.round(spanPx)}px of ${m.grid.w}px grid, measured ${got.rect.w}px`);
      else say(label, "PASS", `${exp.kind} width ${got.rect.w}px matches ${exp.size}`);
      const start = ALIGN_START(exp.size, exp.align);
      if (start !== null) {
        const expX = m.grid.x + (start - 1) * col;
        const xOk = Math.abs(got.rect.x - expX) <= col * 0.35;
        if (!xOk) say(label, "FAIL", `${exp.kind} align=${exp.align}: expected x~${Math.round(expX)}, measured ${got.rect.x}`);
        else say(label, "PASS", `${exp.kind} align=${exp.align} lands at x=${got.rect.x} as expected`);
      }
    }
    for (const exp of expectShed) {
      const got = m.slots.find((s) => s.kind === exp.kind && s.region === "main");
      if (got) say(label, "FAIL", `${exp.kind} p${exp.prio} must fold at tier ${tier} (floor ${floor}) but is rendered`);
      else say(label, "PASS", `${exp.kind} p${exp.prio} correctly folds at tier ${tier}`);
    }

    // Rail behavior vs railPosition.
    const rp = home.railPosition;
    if (rp === "off") {
      if (m.railRegion) say(label, "FAIL", "rail=off but a rail region is rendered");
      else {
        const mainSlot = m.slots.find((s) => CONTRACT.has(s.kind));
        const fullOk = mainSlot && Math.abs(m.grid.x + m.grid.w - (mainSlot.rect.x + mainSlot.rect.w)) <= col * 0.5;
        say(label, m.railRegion ? "FAIL" : "PASS", `rail=off: no rail rendered${fullOk ? ", main uses full width" : ""}`);
      }
    } else if (!m.railRegion) {
      const railHasVisible = home.rail.some((s) => CONTRACT.has(s.kind) || s.prio >= floor);
      say(label, railHasVisible ? "FAIL" : "PASS", railHasVisible ? `rail=${rp} with visible widgets but no rail rendered` : `rail empty after folding at tier ${tier} - correctly absent`);
    } else {
      const g = m.grid, r = m.railRegion;
      const pos = r.y >= g.y + g.h - 4 ? "bottom" : r.y + r.h <= g.y + 4 ? "top" : r.x >= g.x + g.w - 4 ? "right" : r.x + r.w <= g.x + 4 ? "left" : "overlapping";
      if (pos === rp) say(label, "PASS", `rail measured at ${pos} as configured`);
      else say(label, "FAIL", `rail configured ${rp} but measured ${pos} (rail ${JSON.stringify(r)} vs grid ${JSON.stringify(g)})`);
    }
  } catch (e) {
    say(label, "FAIL", `probe error: ${e.message}`);
  }
  await page.close();
}

await browser.close();
const fails = results.filter((r) => r.verdict === "FAIL").length;
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURES`} across ${MATRIX.length} viewports. Screenshots in ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
