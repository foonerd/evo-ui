// Designer undo/redo core - PURE state machine, no preact, contract-
// tested directly. One history covers ALL builders because every
// editor (stage, menu, pages, build canvas) writes the same scoped
// layout slot; the provider observes that slot and feeds changes in.
//
// Semantics:
// - push(before): records the state BEFORE an edit as an undo point.
//   Edits arriving within the burst window after a push coalesce
//   into it (divider drags commit per mousemove - one undo step per
//   gesture, not per pixel).
// - undo(current) -> the entry to restore; `current` becomes a redo
//   point. redo(current) mirrors it.
// - Any fresh edit clears the redo stack (standard linear history).
// - Entries carry their scope + target so an undo lands on the slot
//   it belongs to even after the operator switched scope.

export interface HistoryEntry {
  readonly scope: "native" | "remote";
  readonly targetKey: string | null;
  /** JSON of the stored layout, or null = nothing stored (reset). */
  readonly json: string | null;
}

const CAP = 50;
const BURST_MS = 800;

export class DesignerHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private lastPushAt = -Infinity;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get depth(): number {
    return this.undoStack.length;
  }

  /** Record the pre-edit state. Returns true when a new undo point
   *  was created (false = coalesced into the current burst). */
  push(before: HistoryEntry): boolean {
    this.redoStack = [];
    const t = this.now();
    if (t - this.lastPushAt < BURST_MS) {
      this.lastPushAt = t; // extend the burst window
      return false;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > CAP) this.undoStack.shift();
    this.lastPushAt = t;
    return true;
  }

  /** Pop the undo point; `current` becomes redoable. Null when empty. */
  undo(current: HistoryEntry): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (entry === undefined) return null;
    this.redoStack.push(current);
    this.lastPushAt = -Infinity; // next edit is a fresh undo point
    return entry;
  }

  /** Pop the redo point; `current` becomes undoable again. */
  redo(current: HistoryEntry): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (entry === undefined) return null;
    this.undoStack.push(current);
    if (this.undoStack.length > CAP) this.undoStack.shift();
    this.lastPushAt = -Infinity;
    return entry;
  }

  /** Scope/target switched: the next edit must always start a fresh
   *  undo point regardless of burst timing. History is kept - the
   *  entries carry their own slot. */
  breakBurst(): void {
    this.lastPushAt = -Infinity;
  }
}
