// Verify the selectable long-title behaviour end to end in the designer:
// scroll mode animates an overflowing title; the Scale-tab toggle flips
// it to wrap (2-line clamp) live; title-actions are gone; the feedback
// line is absent when idle.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
await page.locator('.designer-device-screen button[aria-label="Now playing"]').click().catch(() => {});
await page.waitForTimeout(600);

const measure = () => page.evaluate(() => {
  const st = document.querySelector(".designer-device-screen .playback-nowplaying-title .scrolling-text");
  const inner = st ? st.querySelector(".scrolling-text-inner") : null;
  const title = document.querySelector(".designer-device-screen .playback-nowplaying-title");
  const cs = inner ? getComputedStyle(inner) : null;
  return {
    dataMode: st ? st.getAttribute("data-mode") : null,
    animating: st ? st.getAttribute("data-animating") : null,
    viewportClientW: st ? st.clientWidth : null,
    innerScrollW: inner ? inner.scrollWidth : null,
    overflows: st && inner ? inner.scrollWidth > st.clientWidth + 1 : null,
    animationName: cs ? cs.animationName : null,
    titleH: title ? Math.round(title.getBoundingClientRect().height) : null,
    titleText: title ? title.textContent.slice(0, 30) : null,
    actionsPresent: !!document.querySelector(".designer-device-screen .playback-nowplaying-title-actions"),
    feedbackPresent: !!document.querySelector(".designer-device-screen .playback-feedback")
  };
});

report.scroll = await measure();
await page.screenshot({ path: join(OUT, "titlemode-scroll.png") });

// Switch to the Scale tab and choose Wrap.
await page.getByText("Scale", { exact: true }).first().click().catch((e) => report.steps.push("scaletab:" + e));
await page.waitForTimeout(300);
await page.getByText("Wrap", { exact: true }).first().click().catch((e) => report.steps.push("wrap:" + e));
await page.waitForTimeout(500);
report.wrap = await measure();
await page.screenshot({ path: join(OUT, "titlemode-wrap.png") });

// Flip back to Scroll to confirm the toggle is live both ways.
await page.getByText("Scroll", { exact: true }).first().click().catch((e) => report.steps.push("scroll:" + e));
await page.waitForTimeout(400);
report.backToScroll = (await measure()).dataMode;

console.log(JSON.stringify(report, null, 2));
await browser.close(); server.close();
