// Find what clips the track title's top at 480x272: measure the h2
// box and walk its ancestors for any overflow != visible whose top
// sits below the h2 top (the clipper).
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
const DIST = process.argv[2];
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
await picker.getByText("480x272", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(300);
await picker.getByText("4.3in", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(700);
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch(() => {});
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const h2 = document.querySelector(".designer-device-screen .playback-nowplaying h2") || document.querySelector(".designer-device-screen h2");
  if (!h2) return { missing: true };
  const hr = h2.getBoundingClientRect();
  const cs = getComputedStyle(h2);
  const chain = [];
  let el = h2.parentElement;
  while (el && !el.classList.contains("designer-device-screen")) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (s.overflow !== "visible" || s.overflowY !== "visible") {
      chain.push({ cls: (el.className || "").toString().slice(0, 40), top: Math.round(r.top), overflow: s.overflowY, clipsTitle: r.top > hr.top + 0.5 });
    }
    el = el.parentElement;
  }
  const H = (s) => { const e = document.querySelector(".designer-device-screen " + s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
  return {
    titleTop: Math.round(hr.top), titleBottom: Math.round(hr.bottom), titleH: Math.round(hr.height),
    fontSize: cs.fontSize, lineHeight: cs.lineHeight, margin: cs.margin,
    heights: {
      overlay: H(".pivot-overlay-track"),
      surface: H(".playback-surface-pivot-track"),
      stage: H(".playback-stage"),
      stack: H(".playback-stack"),
      feedback: H(".playback-feedback"),
      handle: H(".pivot-overlay-sheet-handle")
    },
    overflowAncestors: chain
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
