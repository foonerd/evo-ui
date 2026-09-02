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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${base}?designer=1&mock=1`, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(900);
const picker = page.locator(".designer-picker");
await page.getByText("Change", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(400);
await picker.getByText("480x272", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(300);
await picker.getByText("4.3in", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(700);
await page.getByText("Portrait", { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(600);
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch(() => {});
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const root = document.querySelector(".designer-device-screen");
  const baseL = root.getBoundingClientRect().left;
  const W = Math.round(root.getBoundingClientRect().width);
  const vol = document.querySelector(".designer-device-screen .playback-volume-row");
  if (!vol) return { missing: true };
  const vr = vol.getBoundingClientRect();
  const kids = [...vol.children].map((k) => {
    const r = k.getBoundingClientRect();
    return { cls: (k.className || "").toString().slice(0, 28), leftInPanel: Math.round(r.left - baseL), rightEdgeFromPanel: Math.round(W - (r.right - baseL)), w: Math.round(r.width), text: (k.textContent || "").slice(0, 6) };
  });
  return {
    panelW: W,
    volRow: { leftInPanel: Math.round(vr.left - baseL), rightEdgeFromPanel: Math.round(W - (vr.right - baseL)), w: Math.round(vr.width), scrollW: vol.scrollWidth, clientW: vol.clientWidth, overflowsX: vol.scrollWidth > vol.clientWidth + 1 },
    kids
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
