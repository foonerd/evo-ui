// Contract: a Network error must still offer Try again.
//
// Field failure: a failed nm.status on the mount refresh pinned the raw
// framework string on the Network page. The only refresh control lived
// on the "did not report its network status" notice, which is gated on
// link.error being null - so the very failure that needed a retry hid
// the retry. The error notice now carries the same Try again, wired to
// the same link.refresh(), under the same locale key. The pair notice
// and the status-unavailable notice are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const landing = readFileSync(
  join(here, "..", "..", "src", "features", "network", "NetworkLanding.tsx"),
  "utf8"
);

/** The JSX block for one notice, from its guard to the closing `: null}`. */
function noticeBlock(guard: RegExp): string {
  const start = landing.search(guard);
  assert.ok(start >= 0, `notice guard not found: ${guard}`);
  const end = landing.indexOf(") : null}", start);
  assert.ok(end > start, "notice block must close");
  return landing.slice(start, end);
}

test("error notice has Try again: the same link.refresh(), the same locale key", () => {
  const block = noticeBlock(/\{!authError && link\.error !== null \? \(/);
  assert.ok(/<span>\{link\.error\}<\/span>/.test(block), "the raw error still paints");
  assert.ok(/onClick=\{\(\) => void link\.refresh\(\)\}/.test(block), "Try again runs the existing refresh");
  assert.ok(/t\("settings\.network\.tryAgain"\)/.test(block), "same Try again copy");
  assert.ok(!/setPairOpen/.test(block), "the error notice is not a pair door");
});

test("pair notice unchanged: authNeeded copy + the pair door, no refresh", () => {
  const block = noticeBlock(/\{authError \? \(/);
  assert.ok(/t\("settings\.network\.authNeeded"\)/.test(block));
  assert.ok(/onClick=\{\(\) => setPairOpen\(true\)\}/.test(block));
  assert.ok(/t\("settings\.network\.pairToManage"\)/.test(block));
  assert.ok(!/link\.refresh\(\)/.test(block), "pair notice gains no refresh");
});

test("status-unavailable path still has Try again", () => {
  const block = noticeBlock(/\{paint === "error" && link\.error === null \? \(/);
  assert.ok(/t\("settings\.network\.statusUnavailable"\)/.test(block));
  assert.ok(/onClick=\{\(\) => void link\.refresh\(\)\}/.test(block));
  assert.ok(/t\("settings\.network\.tryAgain"\)/.test(block));
});

test("one refresh path: every Try again is link.refresh(), and there are exactly two", () => {
  const tryAgains = landing.match(/t\("settings\.network\.tryAgain"\)/g) ?? [];
  assert.equal(tryAgains.length, 2, "error notice + unavailable notice");
  const refreshes = landing.match(/onClick=\{\(\) => void link\.refresh\(\)\}/g) ?? [];
  assert.equal(refreshes.length, 2, "both ride the same refresh, no second path");
  assert.ok(!/refreshStatus|forceRefresh|retryStatus/.test(landing), "no new refresh verb");
});

test("neighbours stay put: CaptivePortal mount, quiet poll, no new copy key", () => {
  assert.ok(/<CaptivePortal link=\{link\} \/>/.test(landing));
  const link = readFileSync(
    join(here, "..", "..", "src", "features", "network", "useNetworkLink.ts"),
    "utf8"
  );
  assert.ok(/}, 4000\);/.test(link), "the quiet 4s poll is untouched");
  const en = readFileSync(join(here, "..", "..", "src", "locales", "en.ts"), "utf8");
  const keys = en.match(/"settings\.network\.tryAgain"/g) ?? [];
  assert.equal(keys.length, 1, "the one existing Try again key, no new copy");
});
