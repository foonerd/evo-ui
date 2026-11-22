// Contract: a busy share refusal is read by its subclass first.
//
// The shares plugin now answers a busy unmount (Disconnect, and the
// unmount inside Remove) with the subclass `share_busy`. The message
// says the share is in use and may name the holders; over the WS the
// body can also arrive as a bare status line ("refused: 400 Bad
// Request"). Neither carries the words the glass used to match ("target
// is busy"), so the page painted the generic line and Disconnect never
// opened Force.
//
// Now the subclass wins:
//  - Sources paints the existing err.shareBusy sentence for any refusal
//    carrying share_busy - Remove, Disconnect, every share verb that
//    runs through the page's one classifier. No second sentence, no
//    holder, no pid:comm, no id.
//  - A first Disconnect refused with share_busy opens the Force confirm,
//    exactly as the busy words always did; a refused Force paints the
//    sentence and opens nothing.
//  - The message-word matcher stays as the fallback for a refusal with
//    no subclass. Other subclasses keep their own lines. The token is
//    named once, in share-busy.
//  - Settings Activity keeps reading the event detail, which still
//    carries the busy words.
// Run:
//   node --experimental-strip-types --test tests/contracts/share-busy-subclass.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as busy from "../../src/features/sources/share-busy.ts";
import { friendlyShareError } from "../../src/features/sources/friendly-error.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  assert.ok(a >= 0, "missing " + from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, "missing " + to);
  return s.slice(a, b);
}

// What the plugin now says, and what the WS can leave of it.
const IN_USE = "network.share unmount refused: the share is in use and was not unmounted. It is held by 47479:plugin.bin. Stop what is using it and try again, or use Force.";
const BARE = "refused: 400 Bad Request";
const OLD_WORDS = "unmount refused for share 1d2c3b4a-0000-4000-8000-000000000001: target is busy; held by 4121:mpd";

test("the subclass wins: share_busy paints err.shareBusy whatever the message says", () => {
  const sentence = en["err.shareBusy"];
  assert.equal(friendlyShareError(BARE, "share_busy"), sentence, "a bare status line with the subclass is busy");
  assert.equal(friendlyShareError(IN_USE, "share_busy"), sentence, "the plugin's own words with the subclass are busy");
  assert.equal(friendlyShareError(undefined, "share_busy"), sentence, "no message at all, still busy");
  for (const raw of [BARE, IN_USE]) {
    assert.ok(!/47479|plugin\.bin|held by|1d2c3b4a/.test(friendlyShareError(raw, "share_busy")), "no holder, no id on the glass");
  }
});

test("the words stay the fallback; other subclasses keep their lines", () => {
  assert.equal(friendlyShareError(OLD_WORDS), en["err.shareBusy"], "no subclass: the busy words still classify");
  assert.equal(friendlyShareError(OLD_WORDS, undefined), en["err.shareBusy"]);
  assert.equal(friendlyShareError(BARE), en["err.generic"], "no subclass and no words: generic, as before");
  assert.equal(friendlyShareError(BARE, "share_unreachable"), en["err.generic"], "another subclass is not busy");
  assert.notEqual(friendlyShareError(BARE, "credential_missing"), en["err.shareBusy"]);
});

test("the wire token is named once, in share-busy", () => {
  assert.equal((busy as Record<string, unknown>)["SHARE_BUSY_SUBCLASS"], "share_busy", "share-busy exports the token");
  const fe = code(src("features/sources/friendly-error.ts"));
  assert.ok(/if \(subclass === SHARE_BUSY_SUBCLASS\) \{/.test(fe), "friendlyShareError reads the token");
  const shareBusyAt = fe.indexOf("subclass === SHARE_BUSY_SUBCLASS");
  const passwordAt = fe.indexOf("isSharePasswordMissing(raw)");
  assert.ok(shareBusyAt > 0 && passwordAt > shareBusyAt, "the subclass answers before any message words");
  assert.ok(!/"share_busy"/.test(code(src("features/sources/SourcesSurface.tsx"))), "the surface names the token through share-busy, never inline");
});

test("Sources: every share verb, Remove included, paints through the subclass", () => {
  const surface = code(src("features/sources/SourcesSurface.tsx"));
  const run = between(surface, "const run = async (", "const runUnmount = async");
  assert.ok(/setFeedback\(friendlyShareError\(r\.message, r\.subclass\)\);/.test(run), "the page classifier reads the subclass");
  assert.ok(/void run\(\(\) => shares\.remove\(id\)\);/.test(surface), "Remove runs through it");
});

test("Disconnect: share_busy paints the sentence and opens Force on the first press only; the Force pin lines stand", () => {
  const surface = code(src("features/sources/SourcesSurface.tsx"));
  const un = between(surface, "const runUnmount = async", "const runEdit = async");
  assert.ok(
    /if \(r\.subclass === SHARE_BUSY_SUBCLASS\) \{\s*setFeedback\(t\("err\.shareBusy"\)\);\s*if \(!force\) setDialog\(\{ kind: "force", share \}\);\s*return;\s*\}/.test(un),
    "busy by subclass: the one sentence, and Force on the first press"
  );
  const busyAt = un.indexOf("if (r.subclass === SHARE_BUSY_SUBCLASS) {");
  const lockAt = un.indexOf("if (isHouseholdLocked(r)) {");
  assert.ok(lockAt > 0 && busyAt > lockAt, "pair and household answer first, as before");
  assert.ok(/setFeedback\(friendlyShareError\(r\.message\)\);\s*if \(!force && isShareBusyReason\(r\.message\)\) \{\s*setDialog\(\{ kind: "force", share \}\);/.test(un), "the fielded Force pin lines are unmoved: the busy words are the fallback");
  assert.ok(busyAt < un.indexOf("setFeedback(friendlyShareError(r.message));"), "the subclass answers before the words");
  assert.equal((surface.match(/force: true/g) ?? []).length, 1, "force: true is still written once");
  assert.ok(!/holders|pid|comm\b/.test(un), "no holder on the glass");
});

test("Activity keeps the event detail; the copy is the existing sentence", () => {
  const feed = src("features/activity/ShareActivityFeed.tsx");
  assert.match(feed, /isBusyEvent\(ev\)/);
  assert.equal(en["err.shareBusy"], "This share is still in use. Stop playback, or wait until the library finishes, then try again.");
  assert.ok(!/share_busy/.test(src("locales/en.ts")), "no new copy key for the token");
});
