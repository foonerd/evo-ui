// Pure structural operations over the stage document - shared by the
// builder outline (sidebar) and the stage canvas so both chromes act
// on ONE model with ONE set of guards. No preact in here: the
// contract suite exercises these directly.
//
// Addressing is by index path (Sel), matching the document's array
// shape - the stored document carries no ids.

import {
  STAGE_CONTRACT_ATOMS,
  type StageAtomKind,
  type StageDoc,
  type StageHAlign,
  type StagePad,
  type StageScale,
  type StageStyle,
  type StageVAlign,
} from "../runtime/stage-document.ts";

/* Mutable mirror of the readonly document for edits. */
export interface MBlock { kind: StageAtomKind; scale?: StageScale }
export interface MCell {
  weight: number; ha?: StageHAlign; va?: StageVAlign;
  pad?: StagePad; scale?: number; style?: StageStyle; atoms: MBlock[];
}
export interface MRow { weight: number; pad?: StagePad; scale?: number; style?: StageStyle; cells: MCell[] }
export interface MCol { weight: number; pad?: StagePad; scale?: number; style?: StageStyle; rows: MRow[] }
export interface MSec {
  weight: number; foldPriority: number;
  pad?: StagePad; scale?: number; style?: StageStyle; cols: MCol[];
}

/** Selection = index path down the tree. */
export type Sel =
  | { k: "sec"; s: number }
  | { k: "col"; s: number; c: number }
  | { k: "row"; s: number; c: number; r: number }
  | { k: "cell"; s: number; c: number; r: number; l: number }
  | { k: "atom"; s: number; c: number; r: number; l: number; a: number };

export const freshCell = (): MCell => ({ weight: 1, atoms: [] });
export const freshRow = (): MRow => ({ weight: 1, cells: [freshCell()] });
export const freshCol = (weight = 1): MCol => ({ weight, rows: [freshRow()] });
export const freshSec = (): MSec => ({ weight: 1, foldPriority: 3, cols: [freshCol()] });

export function cloneSections(doc: StageDoc): MSec[] {
  return JSON.parse(JSON.stringify(doc.sections)) as MSec[];
}

export function nodeAt(secs: MSec[], sel: Sel): MSec | MCol | MRow | MCell | MBlock | undefined {
  const sec = secs[sel.s];
  if (sel.k === "sec" || sec === undefined) return sec;
  const col = sec.cols[sel.c];
  if (sel.k === "col" || col === undefined) return col;
  const row = col.rows[sel.r];
  if (sel.k === "row" || row === undefined) return row;
  const cl = row.cells[sel.l];
  if (sel.k === "cell" || cl === undefined) return cl;
  return cl.atoms[sel.a];
}

export function parentOf(sel: Sel): Sel | null {
  switch (sel.k) {
    case "atom": return { k: "cell", s: sel.s, c: sel.c, r: sel.r, l: sel.l };
    case "cell": return { k: "row", s: sel.s, c: sel.c, r: sel.r };
    case "row": return { k: "col", s: sel.s, c: sel.c };
    case "col": return { k: "sec", s: sel.s };
    case "sec": return null;
  }
}

/* ---------------- contract presence guard ---------------- */

export function atomKindsIn(secs: MSec[], sel: Sel): StageAtomKind[] {
  const node = nodeAt(secs, sel);
  if (node === undefined) return [];
  if (sel.k === "atom") return [(node as MBlock).kind];
  const out: StageAtomKind[] = [];
  const cells: MCell[] =
    sel.k === "cell" ? [node as MCell]
    : sel.k === "row" ? (node as MRow).cells
    : sel.k === "col" ? (node as MCol).rows.flatMap((r) => r.cells)
    : (node as MSec).cols.flatMap((c) => c.rows.flatMap((r) => r.cells));
  for (const cl of cells) for (const b of cl.atoms) out.push(b.kind);
  return out;
}

export function docKindCounts(secs: MSec[]): Partial<Record<StageAtomKind, number>> {
  const counts: Partial<Record<StageAtomKind, number>> = {};
  for (const s of secs)
    for (const c of s.cols)
      for (const r of c.rows)
        for (const l of r.cells)
          for (const b of l.atoms) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return counts;
}

/** True when deleting the selection would strip the LAST instance of
 *  any contract atom. The contract guarantees presence somewhere,
 *  not immortality of every copy. */
export function deleteStripsContract(secs: MSec[], sel: Sel): boolean {
  const doc = docKindCounts(secs);
  const sub: Partial<Record<StageAtomKind, number>> = {};
  for (const k of atomKindsIn(secs, sel)) sub[k] = (sub[k] ?? 0) + 1;
  return [...STAGE_CONTRACT_ATOMS].some(
    (k) => (sub[k] ?? 0) > 0 && (sub[k] ?? 0) >= (doc[k] ?? 0)
  );
}

/* ---------------- structural ops (mutate the mirror) ---------------- */

/** Delete the selected node. Returns false (no mutation) when the
 *  contract guard refuses. */
export function removeAt(secs: MSec[], sel: Sel): boolean {
  if (deleteStripsContract(secs, sel)) return false;
  switch (sel.k) {
    case "sec": secs.splice(sel.s, 1); return true;
    case "col": secs[sel.s]?.cols.splice(sel.c, 1); return true;
    case "row": secs[sel.s]?.cols[sel.c]?.rows.splice(sel.r, 1); return true;
    case "cell": secs[sel.s]?.cols[sel.c]?.rows[sel.r]?.cells.splice(sel.l, 1); return true;
    case "atom": secs[sel.s]?.cols[sel.c]?.rows[sel.r]?.cells[sel.l]?.atoms.splice(sel.a, 1); return true;
  }
}

/** Duplicate the selected node in place (deep copy after it). */
export function duplicateAt(secs: MSec[], sel: Sel): void {
  const node = nodeAt(secs, sel);
  if (node === undefined) return;
  const copy = JSON.parse(JSON.stringify(node)) as never;
  switch (sel.k) {
    case "sec": secs.splice(sel.s + 1, 0, copy); break;
    case "col": secs[sel.s]?.cols.splice(sel.c + 1, 0, copy); break;
    case "row": secs[sel.s]?.cols[sel.c]?.rows.splice(sel.r + 1, 0, copy); break;
    case "cell": secs[sel.s]?.cols[sel.c]?.rows[sel.r]?.cells.splice(sel.l + 1, 0, copy); break;
    case "atom": secs[sel.s]?.cols[sel.c]?.rows[sel.r]?.cells[sel.l]?.atoms.splice(sel.a + 1, 0, copy); break;
  }
}

export function addSectionAfter(secs: MSec[], s: number): void {
  secs.splice(s + 1, 0, freshSec());
}
export function addRow(secs: MSec[], s: number, c: number): void {
  secs[s]?.cols[c]?.rows.push(freshRow());
}
export function addCell(secs: MSec[], s: number, c: number, r: number): void {
  secs[s]?.cols[c]?.rows[r]?.cells.push(freshCell());
}
export function insertAtom(
  secs: MSec[],
  cell: Extract<Sel, { k: "cell" }>,
  kind: StageAtomKind
): void {
  secs[cell.s]?.cols[cell.c]?.rows[cell.r]?.cells[cell.l]?.atoms.push({ kind });
}

/** Insert a NEW atom at an exact position in the cell's line. */
export function insertAtomAt(
  secs: MSec[],
  cell: Extract<Sel, { k: "cell" }>,
  kind: StageAtomKind,
  index: number
): void {
  const target = secs[cell.s]?.cols[cell.c]?.rows[cell.r]?.cells[cell.l];
  if (target === undefined) return;
  const at = Math.max(0, Math.min(target.atoms.length, Math.floor(index)));
  target.atoms.splice(at, 0, { kind });
}

/** Move an existing atom to an exact position - within its own cell
 *  (reorder) or into another cell. Target is validated BEFORE the
 *  take (stale target aborts, loses nothing); a same-cell move
 *  adjusts the index for the removal shift. Returns false when
 *  nothing moved. */
export function moveAtomTo(
  secs: MSec[],
  from: Extract<Sel, { k: "atom" }>,
  to: Extract<Sel, { k: "cell" }>,
  index: number
): boolean {
  const target = secs[to.s]?.cols[to.c]?.rows[to.r]?.cells[to.l];
  if (target === undefined) return false;
  const source = secs[from.s]?.cols[from.c]?.rows[from.r]?.cells[from.l];
  if (source === undefined) return false;
  const sameCell = source === target;
  let at = Math.max(0, Math.min(target.atoms.length, Math.floor(index)));
  if (sameCell) {
    if (at === from.a || at === from.a + 1) return false; // no-op drop
    if (at > from.a) at -= 1; // removal shifts everything after it
  }
  const taken = source.atoms.splice(from.a, 1)[0];
  if (taken === undefined) return false;
  target.atoms.splice(at, 0, taken);
  return true;
}

/** Swap an atom with its neighbour (accessible reorder buttons). */
export function nudgeAtom(
  secs: MSec[],
  at: Extract<Sel, { k: "atom" }>,
  delta: -1 | 1
): boolean {
  const cell = secs[at.s]?.cols[at.c]?.rows[at.r]?.cells[at.l];
  if (cell === undefined) return false;
  const j = at.a + delta;
  if (j < 0 || j >= cell.atoms.length) return false;
  const tmp = cell.atoms[at.a];
  cell.atoms[at.a] = cell.atoms[j];
  cell.atoms[j] = tmp;
  return true;
}

/** Split a section into columns by fraction weights; the first
 *  existing column keeps its content. */
export function splitSection(secs: MSec[], s: number, weights: number[]): void {
  const sec = secs[s];
  if (sec === undefined || weights.length === 0) return;
  const first = sec.cols[0] ?? freshCol();
  sec.cols = weights.map((w, i) => (i === 0 ? ((first.weight = w), first) : freshCol(w)));
}

/** Split a cell into cells inside its row; the original keeps its atoms. */
export function splitCell(
  secs: MSec[],
  sel: Extract<Sel, { k: "cell" }>,
  weights: number[]
): void {
  const row = secs[sel.s]?.cols[sel.c]?.rows[sel.r];
  const keep = row?.cells[sel.l];
  if (row === undefined || keep === undefined || weights.length === 0) return;
  const fresh = weights.map((w, i) =>
    i === 0 ? ((keep.weight = w), keep) : { weight: w, atoms: [] as MBlock[] }
  );
  row.cells.splice(sel.l, 1, ...fresh);
}

/** Structure presets for the split picker (fractions = weights). */
export const SPLIT_PRESETS: readonly (readonly number[])[] = [
  [1, 1], [1, 2], [1, 3], [2, 1], [3, 1], [1, 1, 1], [1, 1, 2], [1, 5, 2],
];

/** Prune sections that lost every column (post-edit hygiene). */
export function pruneEmpty(secs: MSec[]): MSec[] {
  return secs.filter((s) => s.cols.length > 0);
}
