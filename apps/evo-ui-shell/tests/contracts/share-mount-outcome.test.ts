// Contract: a landed share add / mount whose body says the mount failed
// is NOT ok.
//
// Field failure: `network.share.add` lands (the record persists) even
// when the mount it kicked off failed - prompt cancelled or timed out on
// the responder, credential refused, host absent - and says so in the
// body's `mount_error`. The hook dispatched it through dispatchVoid,
// which drops success bodies, so the surface reported ok and the
// operator got a new card with no reason and nothing to retry. This
// pins the decode and the add / mount mapping; the surface's existing
// error line paints the message.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeShareMountOutcome,
  shareMountVerbResult
} from "../../src/features/sources/share-decoders.ts";

test("decode: { mount_error: \"...\" } -> not ok, message kept verbatim", () => {
  const reason = "credential prompt timed out for share.audio";
  const decoded = decodeShareMountOutcome({
    share_id: "86cb08ee",
    mount_report: null,
    mount_error: reason
  });
  assert.deepEqual(decoded, { mountError: reason });
  assert.deepEqual(shareMountVerbResult({ ok: true, value: decoded! }), {
    ok: false,
    message: reason
  });
});

test("decode: { mount_error: null } -> ok", () => {
  const decoded = decodeShareMountOutcome({
    share_id: "86cb08ee",
    mount_report: { share_id: "86cb08ee", negotiated_version: "3.0" },
    mount_error: null
  });
  assert.deepEqual(decoded, { mountError: null });
  assert.deepEqual(shareMountVerbResult({ ok: true, value: decoded! }), {
    ok: true,
    value: undefined
  });
});

test("decode: mount_error omitted (the mount verb's { report } body) -> ok", () => {
  const decoded = decodeShareMountOutcome({
    report: { share_id: "86cb08ee", mount_root: "/var/lib/evo/music/NAS/Audio" }
  });
  assert.deepEqual(decoded, { mountError: null });
  assert.equal(shareMountVerbResult({ ok: true, value: decoded! }).ok, true);
});

test("decode: an empty mount_error is no reason at all -> ok", () => {
  assert.deepEqual(decodeShareMountOutcome({ mount_error: "" }), { mountError: null });
});

test("decode: a non-object body is unrecognised (null), never a silent ok", () => {
  assert.equal(decodeShareMountOutcome(null), null);
  assert.equal(decodeShareMountOutcome("ok"), null);
  assert.equal(decodeShareMountOutcome([]), null);
});

test("a wire refusal passes through untouched, subclass kept for the classifier", () => {
  const refused = { ok: false as const, message: "refused", subclass: "household_policy_locked" };
  assert.deepEqual(shareMountVerbResult(refused), refused);
});

// ---- the hook mapping -------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(
  join(here, "..", "..", "src", "features", "sources", "useNetworkShares.ts"),
  "utf8"
);

test("add and mount ride request() with the mount-outcome decode, not dispatchVoid", () => {
  assert.ok(
    /request\(\s*"network\.share\.add",[\s\S]*?decodeShareMountOutcome/.test(hook),
    "add decodes its body"
  );
  assert.ok(
    /request\(\s*"network\.share\.mount",[\s\S]*?decodeShareMountOutcome/.test(hook),
    "mount decodes its body"
  );
  assert.ok(!/dispatchVoid\("network\.share\.add"/.test(hook), "add no longer drops the body");
  assert.ok(!/dispatchVoid\("network\.share\.mount"/.test(hook), "mount no longer drops the body");
  assert.ok(/shareMountVerbResult\(/.test(hook), "the carried mount_error becomes not-ok");
});

test("edit / unmount / remove stay on dispatchVoid (their bodies carry nothing)", () => {
  assert.ok(/dispatchVoid\("network\.share\.edit"/.test(hook));
  assert.ok(/dispatchVoid\("network\.share\.unmount"/.test(hook));
  assert.ok(/dispatchVoid\("network\.share\.remove"/.test(hook));
});

test("dispatchVoid itself is unchanged: it still returns ok with no value", () => {
  const subject = readFileSync(
    join(here, "..", "..", "src", "runtime", "use-shelf-subject.ts"),
    "utf8"
  );
  assert.ok(/return \{ ok: true, value: undefined \};/.test(subject));
});

test("the surface paints the reason through its existing error line, no new language", () => {
  const surface = readFileSync(
    join(here, "..", "..", "src", "features", "sources", "SourcesSurface.tsx"),
    "utf8"
  );
  assert.ok(/void run\(\(\) => shares\.add\(payload\)\)/.test(surface), "add still runs through run()");
  assert.ok(/setFeedback\(friendlyShareError\(r\.message\)\)/.test(surface), "run() paints the operator line");
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if a landed add or mount with mount_error becomes ok, if
// either stops being one decoded send, if the hook grows a verb, or if
// the adopt path starts unmounting or removing what it just mounted.

test("LOCK share add / mount: mount_error is never ok, one decoded send each, this verb set, a live adopt stays mounted", () => {
  assert.equal(shareMountVerbResult({ ok: true, value: { mountError: "host absent" } }).ok, false);
  assert.equal(shareMountVerbResult({ ok: true, value: { mountError: null } }).ok, true);
  const addFn = hook.slice(hook.indexOf("const add = useCallback("), hook.indexOf("// network.share.edit nests"));
  const mountFn = hook.slice(hook.indexOf("const mount = useCallback("), hook.indexOf("const unmount = useCallback("));
  assert.ok(addFn.length > 0 && mountFn.length > 0);
  assert.equal((addFn.match(/request\(/g) ?? []).length, 1, "add is one send");
  assert.equal((mountFn.match(/request\(/g) ?? []).length, 1, "mount is one send");
  assert.ok(/shareMountVerbResult\(\s*await request\(\s*"network\.share\.add",\s*\{ \.\.\.payload, \.\.\.extra \},\s*decodeShareMountOutcome/.test(addFn));
  assert.ok(/shareMountVerbResult\(\s*await request\(\s*"network\.share\.mount",\s*\{ share_id: shareId, \.\.\.extra \},\s*decodeShareMountOutcome/.test(mountFn));
  assert.ok(!/unmount|remove/.test(addFn + mountFn), "the hook never unmounts or removes what it just mounted");
  const verbs = [...new Set([...hook.matchAll(/"network\.(?:share|discovery)\.[a-z_]+"/g)].map((m) => m[0]))].sort();
  assert.deepEqual(verbs, [
    '"network.discovery.list"',
    '"network.discovery.refresh"',
    '"network.share.add"',
    '"network.share.edit"',
    '"network.share.get_state"',
    '"network.share.list_configured"',
    '"network.share.list_events"',
    '"network.share.mount"',
    '"network.share.remove"',
    '"network.share.unmount"'
  ]);
  const decoders = readFileSync(
    join(here, "..", "..", "src", "features", "sources", "share-decoders.ts"),
    "utf8"
  );
  assert.match(decoders, /"mount_error"/);
  assert.match(decoders, /export function shareMountVerbResult/);
});
