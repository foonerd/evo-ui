// Contract (B1): the operator can restore the last queue. One control, one
// write - queue.restore_last_queue with the versioned envelope and nothing
// else. The player puts the kept queue back, cues the row that was playing
// and pauses; transport and now_playing follow because the player
// publishes them. The glass never sends play (or resume, or
// play_from_position) after the restore: the operator presses play.
// Run:
//   node --experimental-strip-types --test tests/contracts/queue-restore-last.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const hook = readFileSync(join(root, "features", "queue", "useAudioQueue.ts"), "utf8");
const surface = readFileSync(join(root, "features", "queue", "QueueSurface.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

test("the hook has one restore verb and it is the one write", () => {
  assert.ok(/restoreLastQueue: \(\) => Promise<QueueVerbResult>;/.test(hook), "the hook offers restoreLastQueue");
  assert.ok(
    /const restoreLastQueue = useCallback\(\s*\(\) => dispatch\("queue\.restore_last_queue", \{\}\),\s*\[dispatch\]\s*\);/.test(hook),
    "restoreLastQueue is exactly one dispatch of queue.restore_last_queue with an empty envelope"
  );
  assert.equal((hook.match(/queue\.restore_last_queue/g) ?? []).length, 1, "the verb appears once in the hook");
});

test("the restore control sends restore and nothing after it", () => {
  const handler = between(surface, "const onRestoreLastQueue = useCallback(", "}, [");
  assert.ok(/restoreLastQueue\)/.test(handler) || /restoreLastQueue\(\)/.test(handler), "the control calls restoreLastQueue");
  assert.ok(!/play\(|resume\(|playFromPosition\(|playNow\(|"play"|"resume"/.test(handler), "no play after the restore");
  assert.ok(!/\.then\(/.test(handler), "nothing chained after the restore");
  assert.ok(/t\("queue\.restoreLast"\)/.test(surface), "the control is labelled");
  assert.ok(/onClick=\{onRestoreLastQueue\}/.test(surface), "the button is wired to the one handler");
});

test("the whole queue surface never pairs the restore with a play verb", () => {
  // Every occurrence of the verb name on the surface sits in the handler or
  // the button; none of them is followed by a play call in the same statement.
  for (const m of surface.matchAll(/restoreLastQueue/g)) {
    const tail = surface.slice(m.index, (m.index ?? 0) + 160);
    assert.ok(!/play\(|resume\(|playFromPosition\(/.test(tail), "restore is not followed by play");
  }
});

test("the strings exist and are ASCII", () => {
  for (const key of ["queue.restoreLast", "queue.restoreLastHelp"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});
