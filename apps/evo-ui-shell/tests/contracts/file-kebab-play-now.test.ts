// Contract: a file browse kebab is THE browse kebab. Play now
// appends and plays that file (queue kept). Clear and play is
// the composed replace-and-play (audioQueue.playNow). Play next
// and Add stay onEnqueueFile. The Plus button still appends. A
// file tile tap still does nothing. The folder Play button stays
// Play now. Image / cache kebab rows are not this file.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const surface = src("features/library/LibrarySurface.tsx");
const queueHook = src("features/queue/useAudioQueue.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const fileTile = between(surface, "const renderFileTile = (entry: LibraryEntry) => {", "// ----- render ---");
const kebab = between(fileTile, "<KebabMenu", "/>");
const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "");

test("the file kebab is the shared browse list", () => {
  assert.match(kebab, /browseQueueKebabItems\(\{/);
  assert.match(kebab, /mode === "now"\) onPlayNowFile\(entry\)/);
  assert.match(kebab, /mode === "next"\) onEnqueueFile\(entry, true\)/);
  assert.match(kebab, /mode === "append"\) onEnqueueFile\(entry, false\)/);
  assert.match(kebab, /onClearAndPlayFile\(entry\)/);
  assert.match(kebab, /kind: "uris"/);
  assert.match(kebab, /onSave: \(\) => onSaveFile\(entry\)/);
});

test("Play now appends and plays; Clear and play is the replace composition", () => {
  const playNow = code(between(surface, "const onPlayNowFile = useCallback(", "const onClearAndPlayFile = useCallback("));
  assert.match(playNow, /if \(entry\.kind !== "file"\) return;/);
  assert.match(playNow, /audioQueue\.appendAndPlay\(\[entry\.uri\]\)/);
  assert.match(playNow, /runAction\(t\("collection\.playNow"\)/);
  assert.ok(!/playNow\(|clear_queue/.test(playNow), "Play now does not clear");

  const clear = code(between(surface, "const onClearAndPlayFile = useCallback(", "const onSaveFile = useCallback("));
  assert.match(clear, /audioQueue\.playNow\(\[entry\.uri\]\)/);
  assert.match(clear, /runAction\(t\("collection\.clearAndPlay"\)/);
  assert.equal((surface.match(/audioQueue\.playNow\(/g) ?? []).length, 1, "one replace call site on the surface");
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.playNow"]));
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.clearAndPlay"]));
});

test("onEnqueueFile is Next and Add only; Plus still appends; a file tile tap still does nothing", () => {
  const enqueue = between(surface, "const onEnqueueFile = useCallback(", "// ---- Unified queue / playlist actions");
  assert.match(enqueue, /const currentPosition = audioQueue\.queue\?\.currentPosition \?\? null;/);
  assert.match(enqueue, /top && currentPosition !== null \? currentPosition \+ 1 : undefined;/);
  assert.match(enqueue, /top \? t\("collection\.playNext"\) : t\("collection\.addToQueue"\)/);
  assert.match(enqueue, /\(\) => audioQueue\.enqueue\(\[entry\.uri\], position\)/);
  assert.ok(!/playNow|play_from_position|clear/.test(enqueue), "Play now is not folded into it");
  assert.match(fileTile, /onClick=\{\(\) => onEnqueueFile\(entry, false\)\}[\s\S]*?<Plus size=\{14\} \/>/, "Plus appends");
  assert.ok(!/onPrimaryAction/.test(fileTile), "tap is not a second Play now");
});

test("useAudioQueue.playNow is the composition it already was", () => {
  const playNow = between(queueHook, "const playNow = useCallback(", "[dispatch]\n  );");
  assert.match(playNow, /if \(uris\.length === 0\) \{\s*return \{ ok: false, message: t\("queue\.selectionEmpty"\) \};/);
  const order = ["queue.clear_queue", "queue.enqueue", "queue.play_from_position"].map((v) => playNow.indexOf(v));
  assert.ok(order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!, "clear, enqueue, play from 0 - in that order");
  assert.match(playNow, /dispatch\("queue\.play_from_position", \{ position: 0 \}\)/);
  assert.match(playNow, /if \(!cleared\.ok\) return cleared;[\s\S]*if \(!added\.ok\) return added;/, "each step aborts on the first failure");
});

test("the folder Play button stays Play now; drill Play now stays", () => {
  const entries = between(surface, "{visibleEntries.map((entry) => {", "{addToPlaylistTarget !== null ? (");
  assert.match(entries, /onDirectoryQueue\(entry, "now"\)/);
  assert.match(entries, /onDlnaContainerQueue\(entry, "now"\)/);
  assert.match(entries, /browseQueueKebabItems/);
  assert.ok(!/onPlayNowFile/.test(entries), "containers do not use the file URI path");
  const drill = between(surface, '<div className="library-drill-actions">', "</div>");
  assert.match(drill, /onFacetQueue\(drill\.facet, drill\.value, "now"\)[\s\S]*?<Play size=\{14\} \/> \{t\("collection\.playNow"\)\}/);
});

test("the surface header tells the truth about the browse kebab", () => {
  const raw = surface.slice(0, surface.indexOf("import {"));
  assert.ok(/^[\x20-\x7E\n]+$/.test(raw), "7-bit header");
  const header = raw.replace(/\n\/\/ ?/g, " ");
  assert.ok(!/no kebab/.test(header), "directories do have a kebab");
  assert.match(header, /Play now \/ Play next \/ Add to queue \/ Clear and play \/ Add to playlist \/ Save as playlist/i);
  assert.match(header, /file tile tap does nothing/i);
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if useAudioQueue gains or loses a queue verb, or the file
// paths stop composing only the verbs they compose today.

test("LOCK useAudioQueue: the queue verbs are exactly these; Play now and Clear and play compose only them", () => {
  const verbs = [...new Set([...queueHook.matchAll(/"queue\.[a-z_]+"/g)].map((m) => m[0]))].sort();
  assert.deepEqual(verbs, [
    '"queue.append_playlist_to_queue"',
    '"queue.clear_queue"',
    '"queue.enqueue"',
    '"queue.enqueue_selection"',
    '"queue.get_queue"',
    '"queue.load_playlist_to_queue"',
    '"queue.move_queue_item"',
    '"queue.play_from_position"',
    '"queue.remove_queue_item"',
    '"queue.save_queue_as_playlist"',
    '"queue.skip_to_next_available"'
  ]);
  assert.match(
    queueHook,
    /dispatch\("queue\.save_queue_as_playlist", \{\s*playlist_name: playlistName,\s*overwrite: true\s*\}\)/,
    "queue save-as still replaces an existing name"
  );
  const append = between(queueHook, "const appendAndPlay = useCallback(", "const appendAndPlaySelection");
  assert.deepEqual([...new Set([...append.matchAll(/"queue\.[a-z_]+"/g)].map((m) => m[0]))], [], "Play now composes enqueue + playFromPosition, no raw verb");
  assert.match(append, /const start = current\.length;/);
  assert.match(append, /const added = await enqueue\(uris\);/);
  assert.match(append, /return playFromPosition\(start\);/);
  const replace = between(queueHook, "const playNow = useCallback(", "[dispatch]\n  );");
  assert.deepEqual(
    [...replace.matchAll(/"queue\.[a-z_]+"/g)].map((m) => m[0]),
    ['"queue.clear_queue"', '"queue.enqueue"', '"queue.play_from_position"'],
    "Clear and play is exactly clear, enqueue, play from 0"
  );
  assert.equal((surface.match(/audioQueue\.appendAndPlay\(\[entry\.uri\]\)/g) ?? []).length, 1);
  assert.equal((surface.match(/audioQueue\.playNow\(\[entry\.uri\]\)/g) ?? []).length, 1);
});
