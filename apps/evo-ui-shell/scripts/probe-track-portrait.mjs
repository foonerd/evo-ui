// Analyse the track surface at 272x480 (the 480x272 / 4.3in panel
// rotated to portrait). Measures transport wrap, volume/title clipping,
// and horizontal fill; screenshots the device screen.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
const DIST = process.argv[2];
const OUT = process.argv[3] || "/sessions/optimistic-charming-feynman/mnt/outputs";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = join(DIST, normalize(p)); if (!existsSync(fp) || p === "/") fp = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const report = { steps: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(String(e)));
await page.goto(`${base}?designer=1&mock=1`, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(900);
const picker = page.locator(".designer-picker");
await page.getByText("Change", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(400);
await picker.getByText("480x272", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(300);
await picker.getByText("4.3in", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(700);
// Flip to portrait.
await page.getByText("Portrait", { exact: true }).first().click().catch((e) => report.steps.push("portrait:" + e));
await page.waitForTimeout(600);
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch((e) => report.steps.push("up:" + e));
await page.waitForTimeout(500);

report.measure = await page.evaluate(() => {
  const root = document.querySelector(".designer-device-screen");
  const W = root ? Math.round(root.getBoundingClientRect().width) : null;
  const q = (s) => document.querySelector(".designer-device-screen " + s);
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const home = q(".pivot-home");
  const homeR = rect(home);
  const transport = q(".playback-transport-row");
  const volume = q(".playback-volume-row");
  const title = q(".playback-nowplaying-title") || q("h2");
  const stageBody = q(".playback-stage-body");
  let transportWrapped = null, transportRowH = null, btnMaxH = null, btnCount = null;
  if (transport) {
    const r = rect(transport);
    transportRowH = Math.round(r.height);
    const kids = [...transport.children];
    btnCount = kids.length;
    btnMaxH = Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().height)));
    transportWrapped = r.height > btnMaxH * 1.4;
  }
  const sb = rect(stageBody);
  return {
    deviceScreen: root ? `${W}x${Math.round(root.getBoundingClientRect().height)}` : null,
    interaction: document.documentElement.getAttribute("data-interaction"),
    smallLanding: document.documentElement.getAttribute("data-fold-tier"),
    homeWH: homeR ? `${Math.round(homeR.width)}x${Math.round(homeR.height)}` : null,
    stageBodyW: sb ? Math.round(sb.width) : null,
    stageBodyLeftRight: sb && homeR ? `${Math.round(sb.left - homeR.left)}/${Math.round(homeR.right - sb.right)}` : null,
    btnCount, transportRowH, btnMaxH, transportWrapped,
    volumeClipped: volume && homeR ? rect(volume).bottom > homeR.bottom + 1 : null,
    titleClippedTop: title && homeR ? rect(title).top < homeR.top - 1 : null
  };
});
await page.screenshot({ path: join(OUT, "track-portrait-272x480.png") });
const scr = await page.$(".designer-device-screen");
if (scr) await scr.screenshot({ path: join(OUT, "track-portrait-272x480-screen.png") }).catch(() => {});
console.log(JSON.stringify(report, null, 2));
await browser.close(); server.close();
