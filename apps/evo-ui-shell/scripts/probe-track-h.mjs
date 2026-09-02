// Measure the HORIZONTAL geometry of the track surface to find why
// it is crammed left and what consumes the right side. Reports each
// key element's left/right/width relative to the panel, plus the
// layout-relevant computed styles.
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
  let fp = join(DIST, normalize(p));
  if (!existsSync(fp) || p === "/") fp = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); }
  catch { res.writeHead(404); res.end("nf"); }
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

const geom = await page.evaluate(() => {
  const root = document.querySelector(".designer-device-screen");
  const base = root.getBoundingClientRect().left;
  const W = Math.round(root.getBoundingClientRect().width);
  const m = (sel) => {
    const el = document.querySelector(".designer-device-screen " + sel);
    if (!el) return { sel, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      left: Math.round(r.left - base),
      right: Math.round(W - (r.right - base)),
      width: Math.round(r.width),
      display: cs.display,
      justify: cs.justifyContent,
      align: cs.alignItems,
      flexDir: cs.flexDirection,
      flex: cs.flex,
      margin: cs.margin,
      maxWidth: cs.maxWidth,
      alignSelf: cs.alignSelf
    };
  };
  return {
    panelW: W,
    surface: m(".playback-surface-pivot-track"),
    toolbar: m(".playback-toolbar"),
    stage: m(".playback-stage"),
    stageArtPresent: !!document.querySelector(".designer-device-screen .playback-stage-art"),
    stageBody: m(".playback-stage-body"),
    stack: m(".playback-stack"),
    progress: m(".playback-progress"),
    transport: m(".playback-transport-row"),
    volume: m(".playback-volume-row"),
    nowplaying: m(".playback-nowplaying")
  };
});
console.log(JSON.stringify(geom, null, 2));
await browser.close();
server.close();
