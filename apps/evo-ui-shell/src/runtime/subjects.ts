// Reactive subject store. The framework's durable happenings bus
// carries `SubjectStateChanged` / `SubjectForgotten` / `SubjectMerged`
// / `SubjectSplit` for every subject under management. One
// subscription on the WS happenings fan-out drives every consumer
// — settings, themes, transport state, queue, network, plugin
// lifecycle all share this one mechanism. Components binding to a
// subject through `byId.value[id]` re-render whenever a fresh
// happening lands.
//
// Out-of-order delivery: the happening envelope carries a monotonic
// `seq` from the durable bus. The store tracks `lastSeq` per
// subject and refuses earlier seqs so reconnect-with-replay produces
// the correct converged state even when intermediate happenings
// arrive interleaved with live ones.

import { signal, type Signal } from "@preact/signals";

/** One subject under management. */
export interface Subject {
  readonly id: string;
  readonly subjectType: string;
  /** Most recent persisted state, JSON-shaped. `null` until first publish. */
  readonly state: unknown;
  /** Monotonic happenings-bus sequence for this subject's last update. */
  readonly lastSeq: number;
  /** Plugin canonical name that owns the subject. */
  readonly owningPlugin: string;
  /** Wall-clock millisecond timestamp of the last update (best-effort). */
  readonly updatedAtMs: number;
}

/** Discriminated forget reason — mirrors the framework taxonomy. */
export type ForgetReason =
  | "subject_cascade"
  | "claim_retracted"
  | "merged"
  | "split"
  | "unknown";

/**
 * Reactive subject store. Keyed by canonical id. Components consume
 * via `byId.value[canonicalId]`; `signal` semantics ensure the
 * Preact renderer re-runs only the components that depend on the
 * specific subject(s) they read.
 */
export class SubjectStore {
  public readonly byId: Signal<{ readonly [id: string]: Subject }> = signal({});
  /**
   * Highest happenings-bus `seq` observed across any subject. The
   * runtime uses this as the `since` cursor on reconnect so the
   * server replays only the deltas the client missed.
   */
  public readonly cursor: Signal<number> = signal(0);

  /**
   * Apply a decoded `SubjectStateChanged` happening. Refuses
   * out-of-order updates by comparing `seq` against the per-subject
   * `lastSeq`.
   */
  public applyStateChanged(
    seq: number,
    canonicalId: string,
    subjectType: string,
    owningPlugin: string,
    state: unknown,
    updatedAtMs: number,
  ): void {
    const prev = this.byId.value[canonicalId];
    if (prev !== undefined && prev.lastSeq >= seq) {
      // Older or duplicate update; ignore.
      return;
    }
    const next: { [id: string]: Subject } = { ...this.byId.value };
    next[canonicalId] = {
      id: canonicalId,
      subjectType,
      state,
      lastSeq: seq,
      owningPlugin,
      updatedAtMs,
    };
    this.byId.value = Object.freeze(next);
    if (seq > this.cursor.value) this.cursor.value = seq;
  }

  /**
   * Apply a forget event. The subject row drops from the store. The
   * cursor advances even on forget so the replay invariant holds.
   */
  public applyForget(seq: number, canonicalId: string): void {
    if (this.byId.value[canonicalId] !== undefined) {
      const next: { [id: string]: Subject } = { ...this.byId.value };
      delete next[canonicalId];
      this.byId.value = Object.freeze(next);
    }
    if (seq > this.cursor.value) this.cursor.value = seq;
  }

  /**
   * Replace the entire store atomically. Used by the operator
   * "refresh all" flow where the runtime re-reads every subject
   * via `describe_*` ops rather than relying on the replay cursor.
   */
  public replaceAll(subjects: readonly Subject[], cursor: number): void {
    const next: { [id: string]: Subject } = {};
    for (const s of subjects) next[s.id] = s;
    this.byId.value = Object.freeze(next);
    this.cursor.value = cursor;
  }

  public byType(subjectType: string): readonly Subject[] {
    return Object.values(this.byId.value).filter(
      (s) => s.subjectType === subjectType,
    );
  }
}

/** Discriminated decode result a happening dispatcher hands the store. */
export type DecodedHappening =
  | {
      readonly kind: "subject_state_changed";
      readonly seq: number;
      readonly canonicalId: string;
      readonly subjectType: string;
      readonly owningPlugin: string;
      readonly state: unknown;
      readonly atMs: number;
    }
  | {
      readonly kind: "subject_forgotten";
      readonly seq: number;
      readonly canonicalId: string;
      readonly reason: ForgetReason;
    }
  | {
      readonly kind: "subject_merged";
      readonly seq: number;
      readonly retiredIds: readonly string[];
      readonly newId: string;
    }
  | {
      readonly kind: "subject_split";
      readonly seq: number;
      readonly retiredId: string;
      readonly newIds: readonly string[];
    }
  | {
      readonly kind: "ui_shelf_changed";
      readonly seq: number;
      readonly shelfId: string;
      readonly stockings: unknown;
    }
  | {
      readonly kind: "other";
      readonly seq: number;
      readonly variant: string;
    };

/**
 * Decode a happening frame as projected by the WS endpoint:
 * `{ frame_type: "happening", seq, happening: { variant: "...", ... } }`.
 *
 * The happening payload's discriminator is its variant tag plus
 * variant-specific fields. The framework serialises via
 * `#[serde(tag = "...")]` so the field name appears as `kind` on
 * the wire alongside the typed fields.
 *
 * Unknown variants project as `kind: "other"` so consumers can fan
 * them into observability surfaces without the dispatcher having
 * to enumerate every Happening variant the framework emits.
 */
export function decodeHappening(
  seq: number,
  raw: unknown,
): DecodedHappening | null {
  if (!isObject(raw)) return null;
  const variant = stringField(raw, "kind") ?? stringField(raw, "variant");
  if (variant === null) return { kind: "other", seq, variant: "<missing-kind>" };
  switch (variant) {
    case "subject_state_changed":
      return decodeSubjectStateChanged(seq, raw);
    case "subject_forgotten":
      return decodeSubjectForgotten(seq, raw);
    case "subject_merged":
      return decodeSubjectMerged(seq, raw);
    case "subject_split":
      return decodeSubjectSplit(seq, raw);
    case "ui_shelf_changed":
      return decodeUiShelfChanged(seq, raw);
    default:
      return { kind: "other", seq, variant };
  }
}

function decodeSubjectStateChanged(
  seq: number,
  raw: Record<string, unknown>,
): DecodedHappening | null {
  const canonicalId =
    stringField(raw, "canonical_id") ?? stringField(raw, "canonicalId");
  const subjectType =
    stringField(raw, "subject_type") ?? stringField(raw, "subjectType");
  const owningPlugin =
    stringField(raw, "plugin") ?? stringField(raw, "owningPlugin");
  if (canonicalId === null || subjectType === null || owningPlugin === null) {
    return null;
  }
  const newState = "new_state" in raw ? raw.new_state : raw.newState;
  const atMs = numField(raw, "at_ms") ?? numField(raw, "atMs") ?? Date.now();
  return {
    kind: "subject_state_changed",
    seq,
    canonicalId,
    subjectType,
    owningPlugin,
    state: newState ?? null,
    atMs,
  };
}

function decodeSubjectForgotten(
  seq: number,
  raw: Record<string, unknown>,
): DecodedHappening | null {
  const canonicalId =
    stringField(raw, "canonical_id") ?? stringField(raw, "canonicalId");
  if (canonicalId === null) return null;
  const reason = stringField(raw, "reason") as ForgetReason | null;
  return {
    kind: "subject_forgotten",
    seq,
    canonicalId,
    reason: reason ?? "unknown",
  };
}

function decodeSubjectMerged(
  seq: number,
  raw: Record<string, unknown>,
): DecodedHappening | null {
  const newId =
    stringField(raw, "new_canonical_id") ?? stringField(raw, "newCanonicalId");
  const retired = raw["retired_canonical_ids"] ?? raw["retiredCanonicalIds"];
  if (newId === null || !Array.isArray(retired)) return null;
  return {
    kind: "subject_merged",
    seq,
    retiredIds: retired.filter((s): s is string => typeof s === "string"),
    newId,
  };
}

function decodeSubjectSplit(
  seq: number,
  raw: Record<string, unknown>,
): DecodedHappening | null {
  const retiredId =
    stringField(raw, "retired_canonical_id") ??
    stringField(raw, "retiredCanonicalId");
  const newIds = raw["new_canonical_ids"] ?? raw["newCanonicalIds"];
  if (retiredId === null || !Array.isArray(newIds)) return null;
  return {
    kind: "subject_split",
    seq,
    retiredId,
    newIds: newIds.filter((s): s is string => typeof s === "string"),
  };
}

function decodeUiShelfChanged(
  seq: number,
  raw: Record<string, unknown>,
): DecodedHappening | null {
  const shelfId =
    stringField(raw, "shelf_id") ?? stringField(raw, "shelfId");
  if (shelfId === null) return null;
  const stockings = raw["stockings"] ?? [];
  return { kind: "ui_shelf_changed", seq, shelfId, stockings };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}
