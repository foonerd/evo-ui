// Drive the DESIGNER to a small (pivot) target and verify the live
// preview shows the compass - reproducing the exact environment that
// rendered black, then confirming the revert fixes it.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const DIST = process.argv[2];
const OUT = process.argv[3] || "/tmp";
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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}?designer=1&mock=1`, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(1000);

const report = { errors, steps: [] };

// Open the screen picker.
await page.getByText("Change", { exact: false }).first().click().catch((e) => report.steps.push("change-click-fail:" + e));
await page.waitForTimeout(500);
// Dump picker option labels so we can target 480x272.
report.pickerOptions = await page.evaluate(() =>
  [...document.querySelectorAll(".designer-picker button, .designer-picker [role='button'], .designer-picker li")]
    .map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 60)
);
await page.screenshot({ path: join(OUT, "designer-picker.png") });

// Try to choose a 480x272 target: click an element mentioning 480x272 or 480 x 272.
const picker = page.locator(".designer-picker");
try {
  await picker.getByText("480x272", { exact: false }).first().click();
  report.steps.push("clicked 480x272 row");
  await page.waitForTimeout(300);
} catch (e) { report.steps.push("row-click-fail:" + e); }
try {
  await picker.getByText("4.3in", { exact: false }).first().click();
  report.steps.push("clicked 4.3in chip");
} catch (e) { report.steps.push("chip-click-fail:" + e); }
await page.waitForTimeout(700);

const snap = () => page.evaluate(() => {
  const scr = ".designer-device-screen ";
  const r = (s) => { const e = document.querySelector(scr + s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
  const w = (s) => { const e = document.querySelector(scr + s); return e ? Math.round(e.getBoundingClientRect().width) : null; };
  return {
    interaction: document.documentElement.getAttribute("data-interaction"),
    anchorH: r(".pivot-anchor"),
    homeH: r(".pivot-home"),
    queueH: r(".pivot-queue"),
    deviceH: r(".pivot-device"),
    artH: r(".pivot-art"),
    coverWH: `${w(".pivot-art-cover")}x${r(".pivot-art-cover")}`,
    residualH: r(".pivot-art-residual")
  };
});
report.rest = await snap();
await page.screenshot({ path: join(OUT, "designer-rest.png") });

// Swipe left -> art canvas.
await page.locator('.designer-device-screen button[aria-label="Artwork"]').click().catch((e) => report.steps.push("art-fail:" + e));
await page.waitForTimeout(400);
report.art = await snap();
await page.screenshot({ path: join(OUT, "designer-art.png") });
await page.locator(".designer-device-screen .pivot-compass-dismiss").first().click().catch(() => {});
await page.waitForTimeout(300);

// Swipe down -> queue reveal.
await page.locator('.designer-device-screen button[aria-label="Library tiles"]').click().catch((e) => report.steps.push("down-fail:" + e));
await page.waitForTimeout(400);
report.queue = await snap();
await page.screenshot({ path: join(OUT, "designer-queue.png") });
await page.locator(".designer-device-screen .pivot-compass-dismiss").first().click().catch(() => {});
await page.waitForTimeout(300);

// Centre tap -> device reveal.
await page.locator(".designer-device-screen .pivot-anchor").click().catch((e) => report.steps.push("centre-fail:" + e));
await page.waitForTimeout(400);
report.device = await snap();
await page.screenshot({ path: join(OUT, "designer-device.png") });
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
