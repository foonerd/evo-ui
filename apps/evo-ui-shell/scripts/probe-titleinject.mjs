// The designer preview has no live playback track, so to verify the
// long-title rendering we inject a long title into the DOM for each
// mode. wrap is pure CSS (clamp), so injection alone proves it. For
// scroll we also force the animating state to confirm the marquee
// keyframe is wired (the auto overflow-detection is exercised on the
// rig with a real title).
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
const DIST = process.argv[2];
const OUT = process.argv[3] || "/sessions/optimistic-charming-feynman/mnt/outputs";
const LONG = "Symphony No. 9 in D minor, Op. 125 - IV. Ode to Joy (Live at the Royal Albert Hall)";
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
const report = {};
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
await page.getByText("Scale", { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);

// WRAP: select wrap, inject long title -> CSS clamps to 2 lines.
await page.getByText("Wrap", { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);
report.wrap = await page.evaluate((LONG) => {
  const inner = document.querySelector(".designer-device-screen .playback-nowplaying-title .scrolling-text-inner");
  const st = document.querySelector(".designer-device-screen .playback-nowplaying-title .scrolling-text");
  if (inner) inner.textContent = LONG;
  const title = document.querySelector(".designer-device-screen .playback-nowplaying-title");
  return { dataMode: st?.getAttribute("data-mode"), titleH: title ? Math.round(title.getBoundingClientRect().height) : null,
    lineClamp: inner ? getComputedStyle(inner).webkitLineClamp : null };
}, LONG);
await page.waitForTimeout(150);
await page.screenshot({ path: join(OUT, "titleinject-wrap.png") });

// SCROLL: select scroll, inject long title, force the animating state.
await page.getByText("Scroll", { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);
report.scroll = await page.evaluate((LONG) => {
  const st = document.querySelector(".designer-device-screen .playback-nowplaying-title .scrolling-text");
  const inner = st ? st.querySelector(".scrolling-text-inner") : null;
  if (inner) inner.textContent = LONG;
  const dist = inner ? inner.scrollWidth - st.clientWidth : 0;
  if (st && inner && dist > 0) {
    st.setAttribute("data-animating", "true");
    st.setAttribute("style", "text-align:left");
    inner.classList.add("is-animating");
    inner.style.setProperty("--marquee-distance", dist + "px");
    inner.style.animationDuration = "9000ms";
  }
  return { dataMode: st?.getAttribute("data-mode"), overflowPx: dist,
    animationName: inner ? getComputedStyle(inner).animationName : null };
}, LONG);
await page.waitForTimeout(150);
await page.screenshot({ path: join(OUT, "titleinject-scroll.png") });

console.log(JSON.stringify(report, null, 2));
await browser.close(); server.close();
