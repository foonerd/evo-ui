// Contract: a busy Disconnect on a network share is the USB two-step.
//
// First press sends network.share.unmount with share_id only. A busy
// refusal paints the classified sentence (err.shareBusy) and opens the
// Force confirm. Confirm sends { force: true } on the same verb. A
// refused Force paints the sentence and opens nothing. The glass never
// paints holders, pid:comm or a UUID, never reads ev.detail on the
// surface, never imports the file-sharing PasswordField.
//
// Plugin side this pins against (network.shares 3c87ca8):
//   UnmountShareRequest { share_id, force: Option<bool> } - serde
//   default, so an absent field is the clean Disconnect;
//   MountError::Busy Display "unmount refused for share <id>: target
//   is busy" plus "; held by <pid>:<comm>, ..." only when holders are
//   named; the force path never classifies busy.
//
// Goes RED if the first press carries force, if the confirm does not,
// if the busy sentence is not painted (page line and Settings Activity),
// if holders or ev.detail reach SourcesSurface.tsx or ShareActivityFeed,
// or if the copy names a process.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isBusyEvent, isShareBusyReason } from "../../src/features/sources/share-busy.ts";
import { friendlyVerbError } from "../../src/features/sources/friendly-error.ts";
import type { ShareEventItem } from "../../src/features/sources/share-decoders.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

const BUSY_BARE = "unmount refused for share 1d2c3b4a-0000-4000-8000-000000000001: target is busy";
const BUSY_HELD = `${BUSY_BARE}; held by 4121:mpd, 900:evo-index`;
const BUSY_CHAIN = `plugin error: transient error: verb execution failed: ${BUSY_HELD}`;

function ev(kind: ShareEventItem["kind"], detail: string | null): ShareEventItem {
  return {
    shareId: "1d2c3b4a-0000-4000-8000-000000000001",
    alias: "NFFS",
    kind,
    detail,
    negotiatedVersion: null,
    atMs: 100
  };
}

test("classifier: the plugin's busy Display, with and without holders, and the raw umount words", () => {
  assert.equal(isShareBusyReason(BUSY_BARE), true);
  assert.equal(isShareBusyReason(BUSY_HELD), true);
  assert.equal(isShareBusyReason(BUSY_CHAIN), true);
  assert.equal(isShareBusyReason("umount: /var/lib/evo/music/NAS/NFFS: target is busy."), true);
  assert.equal(isShareBusyReason("Device or resource busy"), true);
  assert.equal(isShareBusyReason("umount: device is busy"), true);
  assert.equal(isShareBusyReason(undefined), false);
  assert.equal(isShareBusyReason(null), false);
  assert.equal(isShareBusyReason(""), false);
  assert.equal(
    isShareBusyReason("mount failed for share x: exit=Some(1), stderr=Job failed. See journalctl"),
    false
  );
  assert.equal(isShareBusyReason("authentication refused for share x: exit=Some(13)"), false);
});

test("friendlyVerbError: busy is one sentence, never a holder, never generic, never a permission fault", () => {
  const sentence = en["err.shareBusy"];
  assert.equal(sentence, "This share is still in use. Stop playback, or wait until the library finishes, then try again.");
  for (const raw of [BUSY_BARE, BUSY_HELD, BUSY_CHAIN]) {
    const painted = friendlyVerbError(raw);
    assert.equal(painted, sentence);
    assert.ok(!/4121|mpd|evo-index|held by|1d2c3b4a/.test(painted), "no holder, no id on the glass");
  }
  assert.notEqual(friendlyVerbError(BUSY_HELD), en["err.generic"]);
  assert.notEqual(friendlyVerbError(BUSY_HELD), en["err.permission"]);
  // A refused Force is not busy on the plugin side; it carries the
  // helper's words and stays on the branches it always had.
  assert.equal(
    friendlyVerbError("mount failed for share x: exit=Some(32), stderr=Job failed"),
    en["err.generic"]
  );
  const fe = src("features/sources/friendly-error.ts");
  const busyAt = fe.indexOf("isShareBusyReason(raw)");
  const permAt = fe.indexOf("/permission denied|os error 13");
  assert.ok(busyAt > 0 && permAt > 0 && busyAt < permAt, "busy classifies before the permission branch");
});

test("isBusyEvent: a failed event with the busy reason, nothing else", () => {
  assert.equal(isBusyEvent(ev("unmount_failed", BUSY_HELD)), true);
  assert.equal(isBusyEvent(ev("unmount_failed", BUSY_BARE)), true);
  assert.equal(isBusyEvent(ev("mount_failed", BUSY_BARE)), true);
  assert.equal(isBusyEvent(ev("unmount_failed", null)), false);
  assert.equal(isBusyEvent(ev("unmount_failed", "Job failed")), false);
  assert.equal(isBusyEvent(ev("mounted", BUSY_BARE)), false);
  assert.equal(isBusyEvent(ev("unmounted", BUSY_BARE)), false);
});

test("PIN: first Disconnect is share_id only; busy opens Force; Confirm sends force: true", () => {
  const surface = src("features/sources/SourcesSurface.tsx");
  const hook = src("features/sources/useNetworkShares.ts");
  // The verb: extra rides beside share_id; nothing else on the payload.
  assert.match(
    hook,
    /dispatchVoid\("network\.share\.unmount", \{ share_id: shareId, \.\.\.extra \}\)/
  );
  // The first press: runUnmount(share) with no second argument.
  assert.match(surface, /void runUnmount\(share\)\s*:/, "Disconnect is the clean press");
  // force is a branch on the second press only.
  assert.match(surface, /force \? \{ force: true \} : \{\}/);
  assert.equal((surface.match(/force: true/g) ?? []).length, 1, "force: true is written once");
  // The busy refusal opens the dialog; the sentence is painted first.
  assert.match(surface, /if \(!force && isShareBusyReason\(r\.message\)\) \{\s*setDialog\(\{ kind: "force", share \}\);/);
  assert.match(surface, /setFeedback\(friendlyShareError\(r\.message\)\);\s*if \(!force && isShareBusyReason/);
  // Confirm is the forced press on the same verb.
  assert.match(surface, /kind: "force"; share: ShareItem/);
  assert.match(surface, /void runUnmount\(share, true\);/);
  assert.match(surface, /t\("sources\.force\.title", \{ alias: dialog\.share\.alias \}\)/);
  assert.match(surface, /t\("sources\.force\.message"\)/);
  assert.match(surface, /confirmLabel=\{t\("sources\.force\.confirm"\)\}/);
  assert.match(surface, /destructive/);
});

test("PIN: Settings Activity paints the classified sentence from isBusyEvent - never ev.detail, never holders", () => {
  const feed = src("features/activity/ShareActivityFeed.tsx");
  const sources = src("features/sources/SourcesSurface.tsx");
  const settings = src("features/system/SystemSurface.tsx");
  assert.match(settings, /<ShareActivityFeed \/>/);
  assert.ok(!/ShareActivityFeed/.test(sources), "Sources is not the Activity surface");
  assert.match(feed, /isBusyEvent\(ev\)/);
  assert.match(feed, /sources-activity-reason/);
  assert.match(feed, /\{t\("err\.shareBusy"\)\}/);
  assert.ok(!/ev\.detail/.test(feed), "ev.detail never reaches Activity");
  assert.ok(!/ev\.detail/.test(sources), "ev.detail never reaches Sources");
  assert.ok(
    !/holders\.(join|map|length)|\{\s*holders|\.holders\b/.test(sources),
    "share Force does not paste USB holders"
  );
  assert.ok(!/sources-activity-detail/.test(feed), "the retired journal class stays unused");
  assert.ok(!/from ["'].*PasswordField["']/.test(sources), "file-sharing PasswordField stays held");
  const css = src("styles.css");
  assert.match(css, /\.sources-activity-reason \{/);
});

test("copy: the Force dialog names the share and the risk, never a process", () => {
  assert.equal(en["sources.force.title"], "Force disconnect {alias}?");
  assert.equal(
    en["sources.force.message"],
    "This share is still in use. Force disconnects it anyway. Stop playback first if you can."
  );
  assert.equal(en["sources.force.confirm"], "Force disconnect");
  for (const key of ["err.shareBusy", "sources.force.title", "sources.force.message", "sources.force.confirm"] as const) {
    const text = en[key];
    assert.ok(/^[\x20-\x7E]+$/.test(text), `${key} is 7-bit ASCII`);
    assert.ok(!/\d+:[a-z]|pid|mpd|uuid/i.test(text), `${key} names no process`);
  }
});
