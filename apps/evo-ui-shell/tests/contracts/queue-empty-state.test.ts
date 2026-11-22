// Contract: an empty container or selection paints the empty state; the
// queue is unchanged; never a silent success.
//
// The device answers queue.enqueue_selection with a status line. A DLNA
// container that carries no playable leaf answers { status: "empty",
// enqueued_count: 0 }; an MPD folder or facet that matches nothing
// answers { status: "empty", added_uris_count: 0 }. In both cases the
// device writes nothing to the queue.
//
// Field failure (the folded half): on an MPD folder or facet, Play next,
// Add to queue and Clear and play went through the generic dispatch,
// which returned ok on any non-error answer and never read status. An
// empty selection cleared the feedback strip - a silent no-op. Play now
// already read status.
//
// Now every mode, on both paths, reads status:
//  - DLNA container (every mode): status empty paints containerEmpty.
//    This wiring shipped earlier; it is pinned here so it cannot go back
//    to the generic dispatch.
//  - MPD folder / facet (every mode): status empty paints selectionEmpty.
// Same verb, same payload, one send. No new verb, field or key. Copy is
// the two existing lines.
// Run:
//   node --experimental-strip-types --test tests/contracts/queue-empty-state.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeEnqueueSelectionOutcome } from "../../src/features/queue/audio-queue-decoders.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "queue", "useAudioQueue.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  assert.ok(a >= 0, "missing " + from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, "missing " + to);
  return s.slice(a, b);
}

const h = code(hook);

// ---- the DLNA container (pinned wiring) ----------------------------------

test("DLNA container: the device's empty answer decodes to empty; a lying count is unreadable", () => {
  const empty = {
    v: 1, status: "empty", mode: "replace", kind: "container", enqueued: 0, enqueued_count: 0,
    truncated: false, next_page: null, detail: "container subtree carried no playable leaf items; queue unchanged"
  };
  assert.equal(decodeEnqueueSelectionOutcome(empty)?.status, "empty");
  assert.equal(decodeEnqueueSelectionOutcome({ ...empty, enqueued_count: undefined })?.status, "empty", "enqueued is the fallback key");
  assert.equal(decodeEnqueueSelectionOutcome({ ...empty, enqueued_count: 2, enqueued: 2 }), null, "empty with a count is not empty");
  assert.equal(decodeEnqueueSelectionOutcome({ v: 1, status: "ok", enqueued_count: 4 })?.status, "ok");
});

test("DLNA container, every mode: status empty is containerEmpty, never ok; Play now never plays it", () => {
  const container = between(h, "const enqueueContainer = useCallback(", "const removeItem = useCallback(");
  assert.equal((container.match(/pluginRequest\(/g) ?? []).length, 1, "one send");
  assert.ok(/source_id: sourceId,\s*selection: \{ kind: "container", uri \},\s*mode/.test(container), "the same payload");
  assert.ok(
    /const outcome = decodeEnqueueSelectionOutcome\(result\.value\);\s*if \(outcome === null\) \{\s*return \{ ok: false, message: t\("queue\.containerUnreadable"\) \};\s*\}\s*if \(outcome\.status === "empty"\) \{\s*return \{ ok: false, message: t\("queue\.containerEmpty"\) \};\s*\}\s*return \{ ok: true \};/.test(container),
    "status empty paints containerEmpty; only status ok is ok"
  );
  assert.ok(!/dispatch\(/.test(container), "never the generic dispatch, which ignores status");
  const now = between(h, "const appendAndPlayContainer = useCallback(", "const playNow = useCallback(");
  assert.ok(/const added = await enqueueContainer\(sourceId, uri, "append"\);\s*if \(!added\.ok\) return added;\s*return playFromPosition\(start\);/.test(now), "an empty container is never played");
  const handler = between(code(surface), "const onDlnaContainerQueue = useCallback(", "const onDlnaContainerSave = useCallback(");
  assert.ok(/void runAction\(entry\.name, \(\) =>\s*mode === "now"\s*\? audioQueue\.appendAndPlayContainer\(selectedSource, entry\.uri\)\s*: audioQueue\.enqueueContainer\(\s*selectedSource,\s*entry\.uri,\s*toVerbMode\(mode\)\s*\)/.test(handler), "every mode goes through the status-reading path");
});

// ---- the MPD folder / facet (the folded half) -----------------------------

test("MPD folder / facet, every mode: status empty is selectionEmpty, never ok", () => {
  const status = between(h, "const enqueueSelectionStatus = useCallback(", "const enqueueContainer = useCallback(");
  assert.equal((status.match(/pluginRequest\(/g) ?? []).length, 1, "one send");
  assert.ok(/"queue\.enqueue_selection",\s*\{ v: PAYLOAD_VERSION, selection, mode \}/.test(status), "the same payload");
  assert.ok(
    /const status = enqueueSelectionStatusOf\(result\.value\);\s*if \(status === "empty"\) \{\s*return \{ ok: false, message: t\("queue\.selectionEmpty"\) \};\s*\}\s*if \(status !== "ok"\) \{\s*return \{ ok: false, message: t\("queue\.containerUnreadable"\) \};\s*\}\s*return \{ ok: true \};/.test(status),
    "status empty paints selectionEmpty; only status ok is ok"
  );
  assert.ok(
    /const enqueueSelection = enqueueSelectionStatus;/.test(h),
    "Play next, Add to queue and Clear and play read status like Play now does"
  );
  assert.ok(!/dispatch\("queue\.enqueue_selection"/.test(h), "no enqueue_selection through the generic dispatch, which ignores status");
  assert.equal((h.match(/"queue\.enqueue_selection"/g) ?? []).length, 2, "two sends of the verb: criteria and container");
  const now = between(h, "const appendAndPlaySelection = useCallback(", "const appendAndPlayContainer = useCallback(");
  assert.ok(/const added = await enqueueSelectionStatus\(selection, "append"\);\s*if \(!added\.ok\) return added;\s*return playFromPosition\(start\);/.test(now), "an empty selection is never played");
  const s = code(surface);
  for (const name of ["const onFacetQueue = useCallback(", "const onDirectoryQueue = useCallback("]) {
    const handler = between(s, name, "[audioQueue, runAction");
    assert.ok(/void runAction\(/.test(handler) && /audioQueue\.appendAndPlaySelection\(selection\)/.test(handler) && /audioQueue\.enqueueSelection\(selection, toVerbMode\(mode\)\)/.test(handler), name + " paints through runAction");
  }
});

test("a refused or empty answer is painted by runAction; ok clears the strip", () => {
  const run = between(code(surface), "const runAction = useCallback(", "[busy]");
  assert.ok(/if \(result\.ok\) \{\s*setFeedback\(""\);\s*return true;\s*\}\s*setFeedback\(\s*result\.message \?\? t\("collection\.feedback\.incomplete", \{ label \}\)\s*\);/.test(run));
});

test("the copy: the two existing lines, ASCII, no row id", () => {
  assert.equal(en["queue.containerEmpty"], "This folder has no playable tracks. The queue is unchanged.");
  assert.equal(en["queue.selectionEmpty"], "Nothing to play in this selection.");
  for (const k of ["queue.containerEmpty", "queue.selectionEmpty", "queue.containerUnreadable"]) {
    assert.ok(/^[\x20-\x7e]+$/.test(en[k]), k);
  }
  assert.ok(!/\b[A-Z][0-9]\b/.test(h), "no row id in the hook");
  assert.ok(existsSync(join(root, "features", "queue", "audio-queue-decoders.ts")));
});
