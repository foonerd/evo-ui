import test from "node:test";
import assert from "node:assert/strict";

import { DesignerHistory, type HistoryEntry } from "../../src/dev/designer-history.ts";

const e = (json: string | null, targetKey = "800x480@5"): HistoryEntry => ({
  scope: "native",
  targetKey,
  json,
});

test("undo restores the pre-edit state; redo restores the undone edit", () => {
  const h = new DesignerHistory(() => 0);
  assert.equal(h.canUndo, false);
  h.push(e("A"));
  const back = h.undo(e("B"));
  assert.deepEqual(back, e("A"));
  assert.equal(h.canRedo, true);
  const fwd = h.redo(e("A"));
  assert.deepEqual(fwd, e("B"));
  assert.equal(h.canUndo, true);
  assert.equal(h.canRedo, false);
});

test("burst coalescing: rapid edits form ONE undo point; slow edits form many", () => {
  let t = 0;
  const h = new DesignerHistory(() => t);
  assert.equal(h.push(e("A")), true);   // gesture starts
  t += 100; assert.equal(h.push(e("A1")), false); // drag frames coalesce
  t += 100; assert.equal(h.push(e("A2")), false);
  t += 2000; assert.equal(h.push(e("B")), true);  // new gesture
  assert.equal(h.depth, 2);
  assert.deepEqual(h.undo(e("C")), e("B"));
  assert.deepEqual(h.undo(e("B")), e("A")); // whole first burst = one step
});

test("a fresh edit clears the redo stack (linear history)", () => {
  let t = 0;
  const h = new DesignerHistory(() => t);
  h.push(e("A")); t += 2000;
  h.undo(e("B"));
  assert.equal(h.canRedo, true);
  h.push(e("A*")); // new divergent edit
  assert.equal(h.canRedo, false);
});

test("undo after undo works without a burst guard (breakBurst on pop)", () => {
  let t = 0;
  const h = new DesignerHistory(() => t);
  h.push(e("A")); t += 2000;
  h.push(e("B"));
  // Undo immediately then edit immediately: the edit must still
  // create a fresh undo point despite being inside the burst window.
  h.undo(e("C"));
  assert.equal(h.push(e("B*")), true);
});

test("capacity: history keeps the newest 50 entries", () => {
  let t = 0;
  const h = new DesignerHistory(() => t);
  for (let i = 0; i < 60; i++) { h.push(e(`S${i}`)); t += 2000; }
  assert.equal(h.depth, 50);
  let last: HistoryEntry | null = null;
  for (let i = 0; i < 50; i++) last = h.undo(e("cur"));
  assert.deepEqual(last, e("S10")); // oldest surviving entry
  assert.equal(h.canUndo, false);
});

test("entries carry their slot: cross-scope undo lands where it belongs", () => {
  let t = 0;
  const h = new DesignerHistory(() => t);
  h.push({ scope: "native", targetKey: "800x480@5", json: "N" }); t += 2000;
  h.push({ scope: "remote", targetKey: null, json: "R" }); t += 2000;
  const first = h.undo({ scope: "remote", targetKey: null, json: "R2" });
  assert.equal(first?.scope, "remote");
  const second = h.undo({ scope: "remote", targetKey: null, json: "R" });
  assert.equal(second?.scope, "native");
  assert.equal(second?.targetKey, "800x480@5");
});
