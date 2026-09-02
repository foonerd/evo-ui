// Analyse the track (now-playing control) surface in the designer at
// a given panel target. Selects the target, opens the track reveal,
// screenshots, and measures alignment/overflow facts:
//  - transport row: does it wrap (buttons on >1 line)?
//  - volume row: is its bottom clipped below the panel?
//  - title: is its top clipped above the panel?
// Usage: node probe-track.mjs <dist> <resLabel> <sizeChip> <outName>
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const DIST = process.argv[2];
const RES = process.argv[3] || "480x272";
const SIZE = process.argv[4] || "4.3in";
const NAME = process.argv[5] || RES;
const OUT = process.argv[6] || "/sessions/optimistic-charming-feynman/mnt/outputs";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = join(DIST, normalize(p));
  if (!existsSync(fp) || p === "/") fp = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); }
  catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const report = { res: RES, size: SIZE, steps: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(String(e)));
await page.goto(`${base}?designer=1&mock=1`, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(900);

const picker = page.locator(".designer-picker");
await page.getByText("Change", { exact: false }).first().click().catch((e) => report.steps.push("change:" + e));
await page.waitForTimeout(400);
await picker.getByText(RES, { exact: false }).first().click().catch((e) => report.steps.push("res:" + e));
await page.waitForTimeout(300);
await picker.getByText(SIZE, { exact: false }).first().click().catch((e) => report.steps.push("size:" + e));
await page.waitForTimeout(700);

// Open the track reveal (swipe up). If the landing already IS the
// track (smallLanding=track) the button may be absent - tolerate.
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch((e) => report.steps.push("up:" + e));
await page.waitForTimeout(500);

report.measure = await page.evaluate(() => {
  const scr = document.querySelector(".designer-device-screen");
  const q = (s) => document.querySelector(".designer-device-screen " + s);
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const home = q(".pivot-home");
  const homeR = rect(home);
  const surface = q(".playback-surface-pivot-track") || q(".playback-surface");
  const transport = q(".playback-transport-row");
  const volume = q(".playback-volume-row");
  const title = q(".playback-nowplaying h2") || q("h2");
  // wrap detection: compare transport row height to its tallest child
  let transportWrapped = null, transportRowH = null, btnMaxH = null, btnCount = null;
  if (transport) {
    const r = rect(transport);
    transportRowH = Math.round(r.height);
    const kids = [...transport.children];
    btnCount = kids.length;
    btnMaxH = Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().height)));
    transportWrapped = r.height > btnMaxH * 1.4; // >1 line
  }
  const homeBottom = homeR ? homeR.bottom : null;
  const homeTop = homeR ? homeR.top : null;
  const vR = rect(volume);
  const tR = rect(title);
  return {
    interaction: document.documentElement.getAttribute("data-interaction"),
    deviceScreen: scr ? `${Math.round(rect(scr).width)}x${Math.round(rect(scr).height)}` : null,
    homeH: homeR ? Math.round(homeR.height) : null,
    surfaceH: surface ? Math.round(rect(surface).height) : null,
    btnCount, transportRowH, btnMaxH, transportWrapped,
    volumePresent: !!volume,
    volumeClipped: vR && homeBottom !== null ? vR.bottom > homeBottom + 1 : null,
    volumeBottomVsHomeBottom: vR && homeBottom !== null ? Math.round(vR.bottom - homeBottom) : null,
    titleClippedTop: tR && homeTop !== null ? tR.top < homeTop - 1 : null,
    titleTopVsHomeTop: tR && homeTop !== null ? Math.round(tR.top - homeTop) : null
  };
});
await page.screenshot({ path: join(OUT, `track-${NAME}.png`) });
// Also a tight crop of just the device screen for clarity.
const scrEl = await page.$(".designer-device-screen");
if (scrEl) await scrEl.screenshot({ path: join(OUT, `track-${NAME}-screen.png`) }).catch(() => {});
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
