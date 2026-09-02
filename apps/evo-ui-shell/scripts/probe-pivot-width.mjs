// Walk the ancestor chain from the art reveal overlay up to <body>,
// printing each box's width + layout role, to locate where the pivot
// home stops filling the panel width.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const DIST = process.argv[2];
const W = Number(process.argv[3] || 480);
const H = Number(process.argv[4] || 272);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = join(DIST, normalize(p));
  if (!existsSync(fp) || p === "/") fp = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); }
  catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(700);
await page.locator('button[aria-label="Artwork"]').first().click();
await page.waitForTimeout(350);
const chain = await page.evaluate(() => {
  const out = [];
  let el = document.querySelector(".pivot-overlay");
  while (el && el.tagName !== "HTML") {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 48),
      w: Math.round(r.width),
      display: cs.display,
      flexDir: cs.flexDirection,
      alignItems: cs.alignItems,
      width: cs.width,
      maxWidth: cs.maxWidth,
      margin: cs.margin,
      flex: cs.flex
    });
    el = el.parentElement;
  }
  return out;
});
console.log(JSON.stringify(chain, null, 2));
await browser.close();
server.close();
