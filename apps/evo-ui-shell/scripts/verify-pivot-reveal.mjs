// Headless verification that pivot reveals render with non-zero height.
// Serves the built dist, loads the app at a given viewport, then opens
// each compass reveal in turn and measures the overlay's client height.
// Usage: node verify-pivot-reveal.mjs <dist> <width> <height> <outDir>
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const DIST = process.argv[2];
const W = Number(process.argv[3] || 480);
const H = Number(process.argv[4] || 272);
const OUT = process.argv[5] || "/tmp";
mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png"
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let fp = join(DIST, normalize(urlPath));
  if (!existsSync(fp) || urlPath === "/") fp = join(DIST, "index.html");
  try {
    res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" });
    res.end(readFileSync(fp));
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const out = { viewport: `${W}x${H}`, reveals: [] };

const measure = () => page.evaluate(() => {
  const home = document.querySelector(".pivot-home");
  const ov = document.querySelector(".pivot-overlay, .pivot-home-track-landing");
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
  const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
  return {
    reveal: home ? home.getAttribute("data-pivot-reveal") : null,
    homeH: h(home), panelH: h(ov), panelW: w(ov),
    overflowsViewport: ov ? ov.scrollHeight > ov.clientHeight + 1 : null
  };
});

const dismiss = async () => {
  const d = page.locator(".pivot-compass-dismiss").first();
  if (await d.count()) { await d.click().catch(() => {}); await page.waitForTimeout(250); }
};

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(800);
  out.hasPivotHome = await page.locator(".pivot-home").count();
  out.hasFullLayout = await page.locator(".home-hero:not(.home-hero-pivot)").count();
  out.compassVisible = await page.locator(".pivot-home-rest").count();

  const steps = [
    { name: "art", sel: 'button[aria-label="Artwork"]' },
    { name: "bio", sel: 'button[aria-label="Bio"]' },
    { name: "library", sel: 'button[aria-label="Library tiles"]' },
    { name: "track", sel: 'button[aria-label="Now playing"]' },
    { name: "device", sel: ".pivot-anchor" }
  ];
  for (const s of steps) {
    const btn = page.locator(s.sel).first();
    if (!(await btn.count())) { out.reveals.push({ name: s.name, missing: true }); continue; }
    await btn.click().catch(() => {});
    await page.waitForTimeout(350);
    const m = await measure();
    await page.screenshot({ path: join(OUT, `reveal-${W}x${H}-${s.name}.png`) });
    out.reveals.push({ name: s.name, ...m });
    await dismiss();
  }
} catch (e) {
  out.error = String(e).split("\n")[0];
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
