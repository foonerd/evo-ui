// Menu drawer scroll probe - measures, in a real browser against the
// real device, whether the sidebar menu can reach its first and last
// entries. Prints plain-English PASS/FAIL with pixel numbers, and
// dumps screenshots + the computed styles that govern scrolling, so a
// failure carries its own diagnosis.
//
// Run on the rig:
//   export PATH=<node-bin-dir>:$PATH   # e.g. an nvm-managed toolchain
//   node scripts/menu-scroll-probe.mjs http://192.0.2.24
// RFC 5737 TEST-NET-1 is used in the example so this script
// never carries a routable default; supply the real origin at
// the command line.
//
// Same conventions as builder-matrix-probe: playwright-core headless
// chromium, domcontentloaded + fixed settle (the device WS never goes
// network-idle).

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://192.0.2.24";
const SHOTS = "/tmp/menu-probe";
mkdirSync(SHOTS, { recursive: true });

const VIEWS = [
  { name: "panel 800x480", w: 800, h: 480 },
  { name: "10in 1280x800", w: 1280, h: 800 },
  { name: "phone 390x844", w: 390, h: 844 },
  { name: "desktop 1600x900", w: 1600, h: 900 },
];

const results = [];
const say = (view, verdict, what) => {
  results.push(verdict);
  console.log(`${verdict}  [${view}] ${what}`);
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

for (const view of VIEWS) {
  const page = await browser.newPage({ viewport: { width: view.w, height: view.h } });
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2500);

    // Open the drawer if the fab is the affordance; pinned menus are
    // already visible. Whichever chrome is active, .app-sidebar is
    // the menu.
    const fab = page.locator(".app-nav-fab");
    if (await fab.isVisible().catch(() => false)) {
      await fab.click();
      await page.waitForTimeout(400);
    }

    const m = await page.evaluate(() => {
      const aside = document.querySelector(".app-sidebar");
      if (!aside) return null;
      const cs = getComputedStyle(aside);
      const box = aside.getBoundingClientRect();
      const first = aside.querySelector(".sidebar-brand, .nav-group");
      const kids = aside.querySelectorAll(":scope > *");
      const last = kids[kids.length - 1];
      // Try to scroll to the very bottom, then measure what is
      // reachable.
      aside.scrollTop = 0;
      const topReachable = aside.scrollTop === 0;
      aside.scrollTop = aside.scrollHeight;
      const maxScrollTop = aside.scrollTop;
      const lastBox = last ? last.getBoundingClientRect() : null;
      const firstBoxAfter = first ? first.getBoundingClientRect() : null;
      return {
        chrome: document.querySelector("main")?.dataset.navChrome ?? "?",
        overflowY: cs.overflowY,
        position: cs.position,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        boxTop: Math.round(box.top),
        boxBottom: Math.round(box.bottom),
        boxHeight: Math.round(box.height),
        clientHeight: aside.clientHeight,
        scrollHeight: aside.scrollHeight,
        maxScrollTop,
        topReachable,
        lastChild: last ? last.className : "NONE",
        lastBottomAtMaxScroll: lastBox ? Math.round(lastBox.bottom) : null,
        firstTopAtMaxScroll: firstBoxAfter ? Math.round(firstBoxAfter.top) : null,
        innerH: window.innerHeight,
      };
    });

    if (m === null) {
      say(view.name, "FAIL", "no .app-sidebar in the DOM");
      continue;
    }

    console.log(
      `INFO  [${view.name}] chrome=${m.chrome} position=${m.position} overflowY=${m.overflowY} ` +
        `minH=${m.minHeight} maxH=${m.maxHeight} box=${m.boxTop}..${m.boxBottom} (h=${m.boxHeight}) ` +
        `client=${m.clientHeight} scroll=${m.scrollHeight} innerH=${m.innerH}`
    );

    const overflows = m.scrollHeight > m.clientHeight + 1;
    if (!overflows) {
      // Everything fits - the whole menu must be inside the window.
      if (m.boxBottom <= m.innerH + 1 && m.boxTop >= -1) {
        say(view.name, "PASS", `menu fits (${m.boxHeight}px in ${m.innerH}px window), nothing to scroll`);
      } else {
        say(
          view.name,
          "FAIL",
          `menu does not overflow internally (client=${m.clientHeight} scroll=${m.scrollHeight}) but its box ${m.boxTop}..${m.boxBottom} exceeds the ${m.innerH}px window - the container is taller than the screen and NOT scrollable`
        );
      }
    } else if (m.maxScrollTop <= 0) {
      say(
        view.name,
        "FAIL",
        `content overflows (scroll=${m.scrollHeight} client=${m.clientHeight}) but scrollTop cannot move (overflowY=${m.overflowY}) - scrolling is disabled on the container`
      );
    } else {
      // Scrolled to max: the last child's bottom must be visible
      // inside the container box.
      const lastVisible =
        m.lastBottomAtMaxScroll !== null && m.lastBottomAtMaxScroll <= m.boxBottom + 2;
      if (lastVisible) {
        say(
          view.name,
          "PASS",
          `scrolls to the end: last child (${m.lastChild}) bottom ${m.lastBottomAtMaxScroll}px inside box bottom ${m.boxBottom}px (maxScrollTop=${m.maxScrollTop})`
        );
      } else {
        say(
          view.name,
          "FAIL",
          `even at max scroll (${m.maxScrollTop}px) the last child (${m.lastChild}) bottom sits at ${m.lastBottomAtMaxScroll}px, below box bottom ${m.boxBottom}px - ${m.lastBottomAtMaxScroll - m.boxBottom}px of menu is unreachable`
        );
      }
    }

    await page.screenshot({
      path: `${SHOTS}/${view.name.replace(/[^a-z0-9]+/gi, "-")}.png`,
      fullPage: false,
    });
  } catch (err) {
    say(view.name, "FAIL", `probe error: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

const fails = results.filter((r) => r === "FAIL").length;
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`} - screenshots in ${SHOTS}`);
process.exit(fails === 0 ? 0 : 1);
