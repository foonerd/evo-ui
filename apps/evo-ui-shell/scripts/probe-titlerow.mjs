// Verify how the track title / artist / album are aligned and whether
// they overflow. Measures the title row geometry with the mock track,
// and a forced-long title injected into the DOM.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
const DIST = process.argv[2];
const RES = process.argv[3] || "480x272";
const SIZE = process.argv[4] || "4.3in";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = join(DIST, normalize(p)); if (!existsSync(fp) || p === "/") fp = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${base}?designer=1&mock=1`, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(900);
const picker = page.locator(".designer-picker");
await page.getByText("Change", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(400);
await picker.getByText(RES, { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(300);
await picker.getByText(SIZE, { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(700);
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch(() => {});
await page.waitForTimeout(500);

const measure = (label) => page.evaluate((label) => {
  const q = (s) => document.querySelector(".designer-device-screen " + s);
  const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  const row = q(".playback-nowplaying-title-row");
  const h2 = q(".playback-nowplaying h2");
  const actions = q(".playback-nowplaying-title-actions");
  const artist = q(".playback-nowplaying-artist");
  const surface = q(".playback-surface-pivot-track") || q(".playback-surface");
  const cs = h2 ? getComputedStyle(h2) : null;
  return {
    label,
    title: h2 ? h2.textContent : null,
    surface: rectOf(surface),
    row: rectOf(row),
    h2box: rectOf(h2),
    h2: h2 ? { clientW: h2.clientWidth, scrollW: h2.scrollWidth, clientH: h2.clientHeight, scrollH: h2.scrollHeight,
      lineClamp: cs.webkitLineClamp, display: cs.display, whiteSpace: cs.whiteSpace, textAlign: cs.textAlign, padding: cs.padding,
      overflowsX: h2.scrollWidth > h2.clientWidth + 1, overflowsY: h2.scrollHeight > h2.clientHeight + 1 } : null,
    actions: rectOf(actions),
    artist: rectOf(artist)
  };
}, label);

const real = await measure("mock-title");

// Force a long title + artist to expose overflow behaviour.
await page.evaluate(() => {
  const h2 = document.querySelector(".designer-device-screen .playback-nowplaying h2");
  const ar = document.querySelector(".designer-device-screen .playback-nowplaying-artist");
  if (h2) h2.textContent = "Symphony No. 9 in D minor, Op. 125 - IV. Presto - Allegro assai (Ode to Joy)";
  if (ar) ar.textContent = "The Royal Concertgebouw Orchestra feat. a Very Long Guest Artist Name";
});
await page.waitForTimeout(200);
const long = await measure("forced-long");
await page.screenshot({ path: join("/sessions/optimistic-charming-feynman/mnt/outputs", `titlerow-${RES}-long.png`) });

console.log(JSON.stringify({ real, long }, null, 2));
await browser.close(); server.close();
