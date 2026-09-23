// Contract: USB Remove paints the stages the subject names, and only
// those; the final modal opens only when the Remove succeeded and the
// source is gone.
//
// After Confirm the glass shows the xl working heartbeat; its
// headlines follow storage_usb_drives.removal only; the final modal is
// "USB device is safe to remove." and it opens when that source has
// left the library list after the verb answered ok (Library), or when
// the subject named "safe" / the row is gone after we started
// (Sources — do not wait for the verb; Force's catalogue drop can
// still be on MPD). A volume that is off while the card remains is a
// failure paint, not the modal. No
// stage advances on a timer or on the verb reply; the frame already on
// the subject when the operator pressed is stale and ignored; the
// verb stays one library.remove_source { source_id } for the Library
// and one storage.usb.safe_remove for Sources, Force only as the busy
// fallback; the Library never calls mount / repair / rename /
// safe_remove; non-USB Remove is the existing confirm + runAction.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeUsbDrives,
  decodeUsbDrivesHappening,
  usbRemovalMatches,
  USB_REMOVAL_STAGE_ORDER
} from "../../src/features/sources/usb-drives-decoders.ts";
import {
  usbRemovalHeadlineKey,
  usbRemovalStageKey,
  usbRemovalStageState
} from "../../src/features/sources/usb-removal-paint.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const library = src("features/library/LibrarySurface.tsx");
const sources = src("features/sources/UsbDrivesSurface.tsx");
const heartbeat = src("features/sources/UsbRemovalHeartbeat.tsx");
const hook = src("features/sources/useUsbDrives.ts");
const panel = src("app/components/HeartbeatPanel.tsx");
const css = src("styles.css");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

// Every `stage: <value>` object write in a surface, minus the state
// type annotation and the `stage: null` reset. What is left must be the
// one line fed by the subject frame.
const stageWriters = (s: string): string[] =>
  (s.match(/\bstage: (?!null\b|UsbRemovalStage\b)[^,;}\n]+/g) ?? []).map((w) => w.trim());

// ---- the wire: storage_usb_drives.removal ------------------------------

test("an idle drives envelope has no removal", () => {
  const set = decodeUsbDrives({ v: 1, drives: [], last_update_at_ms: 1 });
  assert.ok(set !== null);
  assert.equal(set.removal, null);
});

test("a removal frame decodes each real stage, and nothing else", () => {
  for (const stage of ["queue", "detach", "eject", "retract", "safe"]) {
    const set = decodeUsbDrives({
      v: 1,
      drives: [],
      last_update_at_ms: 1,
      removal: { stable_id: "Audio", library_source_id: "audio-701124", stage }
    });
    assert.deepEqual(set?.removal, { stableId: "Audio", librarySourceId: "audio-701124", stage });
  }
  const bad = decodeUsbDrives({
    v: 1,
    drives: [],
    last_update_at_ms: 1,
    removal: { stable_id: "Audio", stage: "done" }
  });
  assert.equal(bad?.removal, null, "an unknown stage is no frame, never a guess");
  assert.deepEqual(
    [...USB_REMOVAL_STAGE_ORDER],
    ["queue", "detach", "eject", "retract"],
    "clearing the stick's tracks from the queue is the first stage, then detach / eject / updating"
  );
});

test("queue is the first stage: named -> current with nothing done; detach named -> queue done", () => {
  assert.equal(usbRemovalStageKey("queue"), "library.usbRemoveStageQueue");
  assert.equal(usbRemovalHeadlineKey("queue"), "library.usbRemoveStageQueue");
  assert.equal(usbRemovalStageState("queue", "queue"), "current");
  assert.equal(usbRemovalStageState("detach", "queue"), "pending");
  assert.equal(usbRemovalStageState("retract", "queue"), "pending");
  assert.equal(usbRemovalStageState("queue", "detach"), "done");
  assert.equal(usbRemovalStageState("queue", null), "pending");
  assert.equal(usbRemovalStageState("queue", "safe"), "done");
  const line = en["library.usbRemoveStageQueue"];
  assert.ok(/^[\x20-\x7E]+$/.test(line), "one 7-bit line");
  assert.ok(/queue/i.test(line) && /clear/i.test(line), "says what it is: clearing tracks from the queue");
  assert.ok(!/\[|\]|>/.test(line), "no glyphs");
  assert.notEqual(usbRemovalHeadlineKey("safe"), "library.usbRemoveStageQueue", "safe still leaves the headline on the last work stage");
});

test("a happening carries the same removal onto the subject", () => {
  const set = decodeUsbDrivesHappening({
    type: "subject_state_changed",
    subject_type: "storage_usb_drives",
    new_state: { v: 1, drives: [], last_update_at_ms: 1, removal: { stable_id: "Audio", stage: "safe" } }
  });
  assert.equal(set?.removal?.stage, "safe");
  assert.equal(set?.removal?.librarySourceId, null);
});

test("glass matches the Remove it started, not a neighbour stick", () => {
  const removal = { stableId: "Audio", librarySourceId: "audio-701124", stage: "retract" as const };
  assert.equal(usbRemovalMatches(removal, { sourceId: "audio-701124" }), true);
  assert.equal(usbRemovalMatches(removal, { stableId: "Audio" }), true);
  assert.equal(usbRemovalMatches(removal, { mountPath: "/var/lib/evo/music/USB/Audio" }), true);
  assert.equal(usbRemovalMatches(removal, { sourceId: "other" }), false);
  assert.equal(usbRemovalMatches(removal, { stableId: "Other" }), false);
  assert.equal(usbRemovalMatches(removal, { mountPath: "/var/lib/evo/music/USB/Other" }), false);
  assert.equal(usbRemovalMatches(null, { sourceId: "audio-701124" }), false);
});

// ---- the paint: nothing ahead of the subject ------------------------------

test("the heartbeat claims no stage before a frame names one", () => {
  assert.equal(usbRemovalHeadlineKey(null), "library.usbRemoveWorking");
  for (const s of USB_REMOVAL_STAGE_ORDER) {
    assert.equal(usbRemovalStageState(s, null), "pending", `${s} pending before any frame`);
  }
  assert.ok(/^[\x20-\x7E]+$/.test(en["library.usbRemoveWorking"]));
  assert.ok(!/queue|detach|eject|updat/i.test(en["library.usbRemoveWorking"]), "the working line names no stage");
});

test("a named stage is current, the earlier ones done, the later ones pending", () => {
  assert.equal(usbRemovalHeadlineKey("eject"), "library.usbRemoveStageEject");
  assert.equal(usbRemovalStageState("detach", "eject"), "done");
  assert.equal(usbRemovalStageState("eject", "eject"), "current");
  assert.equal(usbRemovalStageState("retract", "eject"), "pending");
  assert.equal(usbRemovalStageKey("retract"), "library.usbRemoveStageRetract");
});

test("safe paints every stage done and never the modal's line on the heartbeat", () => {
  assert.equal(usbRemovalHeadlineKey("safe"), "library.usbRemoveStageRetract");
  assert.notEqual(usbRemovalHeadlineKey("safe"), "library.usbSafeToRemove");
  assert.notEqual(usbRemovalHeadlineKey("safe"), "library.usbRemoveStageDetach");
  for (const s of USB_REMOVAL_STAGE_ORDER) {
    assert.equal(usbRemovalStageState(s, "safe"), "done");
  }
  assert.equal(en["library.usbSafeToRemove"], "USB device is safe to remove.");
  for (const key of [
    "library.usbRemoveStageQueue",
    "library.usbRemoveStageDetach",
    "library.usbRemoveStageEject",
    "library.usbRemoveStageRetract",
    "library.usbRemoveStillHeld",
    "usb.removeFailed"
  ] as const) {
    assert.ok(/^[\x20-\x7E]+$/.test(en[key]), `${key} is 7-bit`);
  }
});

test("the heartbeat is the xl working panel with a scrim; the sublabel wrapper is a div; the modal is forced", () => {
  assert.ok(/<HeartbeatPanel\s+visible\s+scrim\s+mode="working"/.test(heartbeat));
  assert.ok(/headline=\{t\(usbRemovalHeadlineKey\(props\.stage\)\)\}/.test(heartbeat));
  assert.ok(/usb-removal-stage-\$\{usbRemovalStageState\(s, props\.stage\)\}/.test(heartbeat));
  assert.ok(!/setTimeout|setInterval/.test(heartbeat), "the panel walks no timer");
  assert.ok(/<div className="evo-heartbeat-panel-sublabel">\{sublabel\}<\/div>/.test(panel), "a stage list is valid inside a div");
  assert.ok(!/<p className="evo-heartbeat-panel-sublabel">/.test(panel));
  assert.ok(/<Modal title=\{t\("library\.usbSafeToRemove"\)\} dismissible=\{false\}>/.test(heartbeat), "the ack is forced");
});

test("stages are three brightness tiers, not glyphs: current full, done muted, pending quieter but still legible", () => {
  assert.ok(!/\.usb-removal-stage[\w-]*::(before|after)/.test(css), "no ::before / ::after on the stage list");
  const rule = (name: string): string => {
    const m = css.match(new RegExp(`\\.${name} \\{([^}]*)\\}`));
    assert.ok(m !== null, `${name} rule present`);
    return m[1] ?? "";
  };
  const stage = rule("usb-removal-stage");
  assert.ok(!/content:|position:/.test(stage), "no glyph slot on the stage row");
  const current = rule("usb-removal-stage-current");
  const done = rule("usb-removal-stage-done");
  const pending = rule("usb-removal-stage-pending");
  for (const [name, body] of [["current", current], ["done", done], ["pending", pending]] as const) {
    assert.ok(!/content:|background|border|transform|text-decoration/.test(body), `${name} is brightness only`);
  }
  assert.match(current, /color: var\(--foreground\);/);
  assert.match(current, /opacity: 1;/);
  assert.match(done, /color: var\(--muted-foreground\);/);
  assert.ok(!/opacity: 0\./.test(done), "done is the muted token at full opacity (5.8:1 to 7.0:1 on every card)");
  assert.match(pending, /color: var\(--muted-foreground\);/);
  const pendingOpacity = Number((pending.match(/opacity: (0\.\d+);/) ?? [])[1] ?? "1");
  assert.ok(pendingOpacity >= 0.6 && pendingOpacity < 1, "pending is quieter than done but still reads (>= 3:1 on every card needs >= 0.65)");
  assert.equal(pendingOpacity, 0.65);
});

// ---- Library: one remove_source, subject stages, gone-from-list gate ----

test("Library: Confirm on a USB source sends one library.remove_source and mounts the heartbeat with no stage claimed", () => {
  const confirm = between(library, "onConfirm={() => {", "        />\n      ) : null}\n\n      {usbRemove !== null");
  assert.ok(/if \(target\.kind === "local_usb"\) \{\s*void startUsbRemove\(target\);\s*return;\s*\}/.test(confirm), "USB takes the heartbeat path");
  assert.ok(/void runAction\([\s\S]*?const r = await library\.removeSource\(target\.id\);/.test(confirm), "every other kind is the existing confirm + runAction");
  const start = between(library, "const startUsbRemove = useCallback", "// Stages: from the subject, and only from the subject.");
  assert.equal((start.match(/await /g) ?? []).length, 1, "one send");
  assert.ok(/const r = await library\.removeSource\(target\.id\);/.test(start), "the same verb, { source_id }");
  assert.ok(/staleRemovalRef\.current = usb\.removal;/.test(start), "the frame already on the subject is stale");
  assert.ok(/stage: null,\s*verbDone: false/.test(start), "no stage claimed at Confirm");
  assert.ok(/if \(!r\.ok\) \{\s*setUsbRemove\(null\);\s*setBusy\(false\);\s*setFeedback\(r\.message\);/.test(start), "a refused verb paints and drops the heartbeat");
  assert.ok(!/usb\.(mount|repair|rename|safeRemove)\(/.test(library), "Library never calls mount / repair / rename / safe_remove");
  assert.ok(/dispatch\("library\.remove_source", \{ source_id: sourceId \}\)/.test(src("features/library/useLibrary.ts")));
});

test("Library: a stage changes only on a matching, non-stale subject frame", () => {
  const stages = between(library, "// Stages: from the subject, and only from the subject.", "// The modal gate:");
  assert.ok(/const incoming = usb\.removal;\s*if \(incoming === null \|\| incoming === staleRemovalRef\.current\) return;/.test(stages));
  assert.ok(/usbRemovalMatches\(incoming, \{\s*sourceId: usbRemove\.sourceId,\s*mountPath: usbRemove\.mountPath\s*\}\)/.test(stages));
  assert.ok(/setUsbRemove\(\{ \.\.\.usbRemove, stage: incoming\.stage \}\);/.test(stages), "the subject's stage, verbatim");
  assert.ok(/\}, \[usb\.removal, usbRemove\]\);/.test(stages), "keyed on the subject");
  // No other line in the surface writes a stage.
  assert.deepEqual(stageWriters(library), ["stage: incoming.stage"], "exactly one stage writer, fed by the subject");
});

test("Library: the modal opens only on verb ok AND the source gone from the list; the timer is a failure paint", () => {
  const gate = between(library, "// The modal gate: verb ok AND the source gone from the library list.", "const onRefresh = useCallback");
  assert.ok(/if \(usbRemove === null \|\| !usbRemove\.verbDone\) return;/.test(gate), "no modal before the verb answered ok");
  assert.ok(/const gone =\s*sources !== null &&\s*!sources\.some\(\(s\) => s\.id === usbRemove\.sourceId\);/.test(gate));
  assert.ok(/if \(gone\) \{\s*setUsbRemove\(null\);\s*setUsbSafeModal\(true\);\s*setBusy\(false\);\s*return;/.test(gate), "heartbeat down, modal up, in one render");
  const timer = between(gate, "window.setTimeout(() => {", "}, USB_REMOVE_LIST_GRACE_MS);");
  assert.ok(/setFeedback\(t\("library\.usbRemoveStillHeld"\)\)/.test(timer), "the bounded wait ends in the failure paint");
  assert.ok(!/setUsbSafeModal|stage/.test(timer), "the timer never opens the modal and never sets a stage");
  assert.ok(/\}, \[usbRemove, sources\]\);/.test(gate));
  assert.equal((library.match(/setUsbSafeModal\(true\)/g) ?? []).length, 1, "one way to the modal");
});

// ---- Sources: one safe_remove, subject stages, "safe" gate ---------------

test("Sources: with a library id, Safe remove sends library.remove_source; safe_remove only when force or no id", () => {
  const run = between(sources, "const runSafeRemove = async", "const renameValid =");
  assert.ok(
    /!force && drive\.librarySourceId !== null/.test(run),
    "the library path is the adopted drive, not Force"
  );
  assert.ok(
    /library\.removeSource\(drive\.librarySourceId\)/.test(run),
    "with an id and no force, one library.remove_source"
  );
  assert.ok(
    /usb\.safeRemove\(\s*drive\.stableId,\s*force,\s*drive\.librarySourceId\s*\)/.test(run),
    "usb.safeRemove is reachable only when force or the id is null"
  );
  assert.equal(
    (run.match(/library\.removeSource\(/g) ?? []).length,
    1,
    "exactly one library send"
  );
  assert.equal(
    (run.match(/usb\.safeRemove\(/g) ?? []).length,
    1,
    "exactly one usb send"
  );
  assert.ok(/staleRemovalRef\.current = usb\.removal;/.test(run));
  assert.ok(/stage: null,\s*verbDone: false/.test(run), "no stage claimed at the press");
  assert.ok(/refuse\(r, drive, "saferemove"\)/.test(run), "the one classifier");
  assert.ok(/subclass: null/.test(run), "the library refuse adapts to UsbVerbResult");
  assert.ok(/onClick=\{\(\) => void runSafeRemove\(drive\)\}/.test(sources));
  assert.ok(/void runSafeRemove\(d, true\);/.test(sources), "Force confirm still runSafeRemove(d, true)");
  assert.ok(
    /if \(ctx === "saferemove"\) \{\s*setModal\(\{ kind: "force", drive, holders: r\.data\.holders \}\);/.test(sources),
    "a Safe Remove refuse is Force, never That didn't work"
  );
  assert.ok(!/ctx === "saferemove" &&/.test(sources), "Force is not gated on a busy token the library path never carries");
  assert.equal((sources.match(/useLibrary\(\)/g) ?? []).length, 1, "useLibrary imported once");
  assert.ok(/from "\.\.\/library\/useLibrary"/.test(sources));
  assert.ok(/await run\(\(\) => usb\.rename\(drive\.stableId, alias\), drive, "rename"\);/.test(sources), "rename Confirm untouched");
  assert.ok(/usb\.repair\(/.test(sources) && !/library\.removeSource/.test(between(sources, "const refuse = (", "const runSafeRemove = async")), "repair / refuse / run untouched");
  assert.ok(!/library\.removeSource/.test(between(sources, "const renameValid =", "const managed = (drives ?? [])")), "the stage and gate effects send nothing");
  assert.ok(/library_source_id: librarySourceId/.test(hook), "the hook forwards the library source id");
  assert.ok(/removal: subject\.state === null \? null : subject\.state\.removal/.test(hook), "the hook exposes the subject's removal");
});

test("Sources: a stage changes only on a matching, non-stale subject frame; safe opens the modal without waiting for the verb", () => {
  const stages = between(sources, "// Stages: from the subject, and only from the subject.", "// The modal gate:");
  assert.ok(/if \(incoming === null\) return;/.test(stages));
  assert.ok(/incoming === staleRemovalRef\.current && incoming\.stage !== "safe"/.test(stages), "a leftover safe frame is not ignored");
  assert.ok(/usbRemovalMatches\(incoming, \{\s*stableId: usbRemove\.stableId,\s*sourceId: usbRemove\.librarySourceId \?\? undefined\s*\}\)/.test(stages));
  assert.ok(/order\.indexOf\(incoming\.stage\) < order\.indexOf\(prev\)/.test(stages), "Force must not rewind retract over safe");
  assert.ok(/setUsbRemove\(\{ \.\.\.usbRemove, stage: incoming\.stage \}\);/.test(stages));
  assert.deepEqual(stageWriters(sources), ["stage: incoming.stage"], "exactly one stage writer, fed by the subject");
  const gate = between(sources, "// The modal gate: the subject named \"safe\"", "const managed = (drives ?? [])");
  assert.ok(/if \(usbRemove\.stage === "safe" \|\| \(gone && usbRemove\.stage !== null\)\)/.test(gate), "safe, or gone after we started, opens the modal");
  assert.ok(/if \(!usbRemove\.verbDone\) return;/.test(gate), "the grace timer still waits for the verb");
  const timer = between(gate, "window.setTimeout(() => {", "}, USB_REMOVE_SAFE_GRACE_MS);");
  assert.ok(/setFeedback\(t\("usb\.removeFailed"\)\)/.test(timer));
  assert.ok(!/setUsbSafeModal|stage/.test(timer), "the timer never opens the modal and never sets a stage");
  assert.equal((sources.match(/setUsbSafeModal\(true\)/g) ?? []).length, 1, "one way to the modal");
});

test("both surfaces mount the heartbeat and the modal from the same pair; the Remove paths touch no playback state", () => {
  for (const s of [library, sources]) {
    assert.ok(/\{usbRemove !== null \? \(\s*<UsbRemovalHeartbeat visible stage=\{usbRemove\.stage\} \/>\s*\) : null\}/.test(s));
    assert.ok(/\{usbSafeModal \? \(\s*<UsbSafeToRemoveModal onAck=\{\(\) => setUsbSafeModal\(false\)\} \/>\s*\) : null\}/.test(s));
  }
  const removePaths = [
    between(library, "const startUsbRemove = useCallback", "// Stages: from the subject, and only from the subject."),
    between(sources, "const runSafeRemove = async", "const renameValid =")
  ];
  for (const p of removePaths) {
    assert.ok(!/\bstop\(|clear_queue|purge|favourite|playlist/.test(p), "no stop-play, no queue / playlist / favourite purge");
  }
  // The other heartbeat users still pass a sublabel to the same panel.
  for (const rel of ["features/audio/AudioOptionsPanel.tsx", "features/multiroom/MultiroomSurface.tsx"]) {
    assert.ok(/<HeartbeatPanel/.test(src(rel)), `${rel} still uses HeartbeatPanel`);
  }
});
