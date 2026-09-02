import test from "node:test";
import assert from "node:assert/strict";

import { CLASSIC_STAGE } from "../../src/runtime/stage-document.ts";
import {
  insertAtomAt as _insertAtomAt,
  moveAtomTo as moveAtomToRef,
  nudgeAtom as _nudgeAtom,
  addCell,
  addRow,
  addSectionAfter,
  cloneSections,
  deleteStripsContract,
  duplicateAt,
  insertAtom,
  nodeAt,
  parentOf,
  removeAt,
  splitCell,
  splitSection,
  type Sel,
} from "../../src/dev/stage-editor-ops.ts";

const clone = () => cloneSections(CLASSIC_STAGE);
const opsExtra = { insertAtomAt: _insertAtomAt, moveAtomTo: moveAtomToRef, nudgeAtom: _nudgeAtom };

test("presence guard counts instances: duplicate contract atoms delete, the last refuses", () => {
  const secs = clone();
  // classic: exactly one artist (s1,c1,r0,l0,a0)
  const artist: Sel = { k: "atom", s: 1, c: 1, r: 0, l: 0, a: 0 };
  assert.equal(deleteStripsContract(secs, artist), true);
  assert.equal(removeAt(secs, artist), false); // refused, no mutation
  assert.equal(secs[1].cols[1].rows[0].cells[0].atoms.length, 1);
  duplicateAt(secs, artist);
  assert.equal(deleteStripsContract(secs, artist), false);
  assert.equal(removeAt(secs, artist), true);
  assert.equal(secs[1].cols[1].rows[0].cells[0].atoms.length, 1);
});

test("subtree guard: a section holding the last play refuses; empty structure deletes freely", () => {
  const secs = clone();
  // classic section 3 holds the only play atom
  assert.equal(removeAt(secs, { k: "sec", s: 3 }), false);
  addSectionAfter(secs, 4);
  assert.equal(removeAt(secs, { k: "sec", s: 5 }), true); // fresh empty section
});

test("duplicate deep-copies (no aliasing)", () => {
  const secs = clone();
  duplicateAt(secs, { k: "sec", s: 0 });
  secs[1].cols[0].rows[0].cells[0].atoms[0].kind = "album";
  assert.equal(secs[0].cols[0].rows[0].cells[0].atoms[0].kind, "title");
});

test("splitSection keeps the first column's content; splitCell keeps atoms", () => {
  const secs = clone();
  splitSection(secs, 1, [1, 2, 1]);
  assert.equal(secs[1].cols.length, 3);
  assert.equal(secs[1].cols[0].rows[0].cells[0].atoms[0].kind, "art"); // kept
  assert.deepEqual(secs[1].cols.map((c) => c.weight), [1, 2, 1]);
  const cellSel: Sel & { k: "cell" } = { k: "cell", s: 0, c: 0, r: 0, l: 0 };
  splitCell(secs, cellSel, [2, 1]);
  assert.equal(secs[0].cols[0].rows[0].cells.length, 2);
  assert.equal(secs[0].cols[0].rows[0].cells[0].atoms[0].kind, "title"); // kept
  assert.equal(secs[0].cols[0].rows[0].cells[1].atoms.length, 0);
});

test("insert/add ops land where addressed; parentOf walks up", () => {
  const secs = clone();
  addRow(secs, 0, 0);
  addCell(secs, 0, 0, 1);
  insertAtom(secs, { k: "cell", s: 0, c: 0, r: 1, l: 0 }, "nav");
  assert.equal(secs[0].cols[0].rows[1].cells[0].atoms[0].kind, "nav");
  assert.deepEqual(parentOf({ k: "atom", s: 0, c: 0, r: 1, l: 0, a: 0 }),
    { k: "cell", s: 0, c: 0, r: 1, l: 0 });
  assert.deepEqual(parentOf({ k: "sec", s: 0 }), null);
  const cell = nodeAt(secs, { k: "cell", s: 0, c: 0, r: 1, l: 0 });
  assert.ok(cell !== undefined && "atoms" in (cell as object));
});

test("insertAtomAt lands at the exact index and clamps out-of-range", () => {
  const secs = clone();
  const cell: Sel & { k: "cell" } = { k: "cell", s: 3, c: 0, r: 0, l: 0 };
  // classic transport: shuffle, prev, play, next, repeatAll
  const { insertAtomAt } = opsExtra;
  insertAtomAt(secs, cell, "fav", 2);
  assert.deepEqual(
    secs[3].cols[0].rows[0].cells[0].atoms.map((a) => a.kind),
    ["shuffle", "prev", "fav", "play", "next", "repeatAll"]
  );
  insertAtomAt(secs, cell, "nav", 999); // clamps to end
  assert.equal(secs[3].cols[0].rows[0].cells[0].atoms.at(-1)?.kind, "nav");
});

test("moveAtomTo reorders within a cell with correct index shift, both directions", () => {
  const secs = clone();
  const cell: Sel & { k: "cell" } = { k: "cell", s: 3, c: 0, r: 0, l: 0 };
  const { moveAtomTo } = opsExtra;
  // forward: shuffle(0) -> before repeatAll(4): removal shifts, ends at 3
  assert.equal(moveAtomTo(secs, { ...cell, k: "atom", a: 0 }, cell, 4), true);
  assert.deepEqual(
    secs[3].cols[0].rows[0].cells[0].atoms.map((a) => a.kind),
    ["prev", "play", "next", "shuffle", "repeatAll"]
  );
  // backward: repeatAll(4) -> index 0
  assert.equal(moveAtomTo(secs, { ...cell, k: "atom", a: 4 }, cell, 0), true);
  assert.deepEqual(
    secs[3].cols[0].rows[0].cells[0].atoms.map((a) => a.kind),
    ["repeatAll", "prev", "play", "next", "shuffle"]
  );
  // dropping an atom onto its own position is a no-op
  assert.equal(moveAtomTo(secs, { ...cell, k: "atom", a: 2 }, cell, 2), false);
  assert.equal(moveAtomTo(secs, { ...cell, k: "atom", a: 2 }, cell, 3), false);
});

test("moveAtomTo across cells validates target BEFORE take - stale target loses nothing", () => {
  const secs = clone();
  const from: Sel & { k: "atom" } = { k: "atom", s: 3, c: 0, r: 0, l: 0, a: 0 };
  const badCell: Sel & { k: "cell" } = { k: "cell", s: 9, c: 0, r: 0, l: 0 };
  assert.equal(moveAtomToRef(secs, from, badCell, 0), false);
  assert.equal(secs[3].cols[0].rows[0].cells[0].atoms.length, 5); // intact
  const goodCell: Sel & { k: "cell" } = { k: "cell", s: 0, c: 0, r: 0, l: 0 };
  assert.equal(moveAtomToRef(secs, from, goodCell, 0), true);
  assert.equal(secs[0].cols[0].rows[0].cells[0].atoms[0].kind, "shuffle");
  assert.equal(secs[3].cols[0].rows[0].cells[0].atoms.length, 4);
});

test("nudgeAtom swaps neighbours and refuses at the edges", () => {
  const secs = clone();
  const { nudgeAtom } = opsExtra;
  const at = (a: number): Sel & { k: "atom" } => ({ k: "atom", s: 3, c: 0, r: 0, l: 0, a });
  assert.equal(nudgeAtom(secs, at(0), -1), false); // top edge
  assert.equal(nudgeAtom(secs, at(0), 1), true);
  assert.deepEqual(
    secs[3].cols[0].rows[0].cells[0].atoms.slice(0, 2).map((a) => a.kind),
    ["prev", "shuffle"]
  );
  assert.equal(nudgeAtom(secs, at(4), 1), false); // bottom edge
});
