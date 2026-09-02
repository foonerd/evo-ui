// Reactive store of admitted UI stockings + shelf contracts +
// widget-kind envelopes. Source of truth: the framework's
// `describe_ui_stockings` wire-op (one round trip projects shelves
// + widget kinds + admitted entries) and `UiShelfChanged` happening
// stream (incremental update per shelf). Every UI surface consumes
// this store; updates fan out through Preact signals so the
// renderer reconciles incrementally without page reloads.

import { signal, type Signal } from "@preact/signals";

/**
 * Canonical stocking shape as projected by the framework's
 * `describe_ui_stockings` wire-op. Field names mirror the wire
 * shape (`plugin`, `ui_shelf`, `widget`) — server-side rust uses
 * those identifiers verbatim.
 */
export interface AdmittedStocking {
  readonly plugin: string;
  readonly shelfId: string;
  readonly widgetKindId: string;
  readonly size: string;
  readonly mode?: string;
  readonly schemaVersion: number;
}

/**
 * Decoded shelf contract — mirrors the SDK's `ShelfContract` shape.
 * Carries everything the renderer needs to compose a shelf: which
 * widget kinds it admits, which sizes are valid, what layout to
 * use, how to order stockings, and the cardinality envelope.
 */
export interface ShelfContract {
  readonly id: string;
  readonly label?: string;
  readonly cardinality: ShelfCardinality;
  readonly acceptsWidgets: AcceptedWidgets;
  readonly acceptsSizes: readonly UiSize[];
  readonly layout: ShelfLayout;
  readonly orderBy: ShelfOrder;
  readonly defaultWidget?: string;
  readonly schemaVersion: number;
  readonly minCompatibleVersion?: number;
}

export type ShelfCardinality = "exactly-one" | "at-most-one" | "any-to-many";

export type ShelfLayout =
  | "single"
  | "grid"
  | "grid-responsive"
  | "list"
  | "tabs"
  | "stack-modal";

export type ShelfOrder =
  | "manifest_declaration"
  | "alphabetical"
  | "category"
  | "operator_curated"
  | "priority_then_creation";

export type UiSize =
  | "atom"
  | "quarter"
  | "third"
  | "half"
  | "two-thirds"
  | "full";

export type UiMode = "inline" | "modal" | "overlay" | "floating";

export type UiAspect = "any" | "square" | "wide" | "tall";

export type UiBreakpoint = "compact" | "regular" | "wide";

/** Discriminated union mirroring `AcceptedWidgets`. */
export type AcceptedWidgets =
  | { readonly kind: "any" }
  | { readonly kind: "allowed"; readonly patterns: readonly string[] };

/**
 * Per-widget-kind envelope — mirrors the SDK's `WidgetKindEnvelope`.
 * The renderer consults this to pick the active size at the current
 * viewport breakpoint and to refuse stockings whose declared size is
 * outside the envelope's admissible range.
 */
export interface WidgetKindEnvelope {
  readonly id: string;
  readonly minSize: UiSize;
  readonly idealSize: UiSize;
  readonly maxSize: UiSize;
  readonly aspectRatio: UiAspect;
  readonly responsive: { readonly [bp in UiBreakpoint]?: UiSize };
  readonly mode: UiMode;
  readonly schemaVersion: number;
}

/**
 * Stockings keyed by shelf id. The store keeps stockings grouped by
 * shelf so the renderer can mount one component tree per shelf and
 * reconcile within the shelf on change events.
 */
export interface StockingsByShelf {
  readonly [shelfId: string]: readonly AdmittedStocking[];
}

/** Combined snapshot of the entire schema-first UI substrate. */
export interface UiSnapshot {
  readonly shelves: { readonly [id: string]: ShelfContract };
  readonly widgetKinds: { readonly [id: string]: WidgetKindEnvelope };
  readonly stockings: StockingsByShelf;
}

const EMPTY_SNAPSHOT: UiSnapshot = Object.freeze({
  shelves: Object.freeze({}),
  widgetKinds: Object.freeze({}),
  stockings: Object.freeze({}),
});

/**
 * Mutable store backing the runtime's reactive view of admitted
 * stockings + declared shelf contracts + declared widget kinds.
 * Bind the renderer to `snapshot.value` to track every update; call
 * `replaceAll` once at boot after `describe_ui_stockings` returns
 * and `applyShelf` for each `UiShelfChanged` happening received on
 * the WebSocket fan-out.
 */
export class StockingStore {
  public readonly snapshot: Signal<UiSnapshot> = signal<UiSnapshot>(EMPTY_SNAPSHOT);

  /** Replace the entire snapshot atomically. Called once at boot. */
  public replaceAll(snapshot: UiSnapshot): void {
    this.snapshot.value = freezeSnapshot(snapshot);
  }

  /**
   * Apply an incremental shelf-level change. `UiShelfChanged`
   * happenings carry the new admitted set for one shelf; the store
   * overwrites that shelf's slot in place.
   */
  public applyShelf(shelfId: string, stockings: readonly AdmittedStocking[]): void {
    const prev = this.snapshot.value;
    const nextStockings: Record<string, readonly AdmittedStocking[]> = {
      ...prev.stockings,
    };
    nextStockings[shelfId] = stockings;
    this.snapshot.value = freezeSnapshot({
      shelves: prev.shelves,
      widgetKinds: prev.widgetKinds,
      stockings: nextStockings,
    });
  }

  /**
   * Remove a shelf entirely from the store's stocking map. Called
   * when a `UiShelfChanged` happening reports the shelf was
   * forgotten — every stocking plugin drained.
   */
  public forgetShelf(shelfId: string): void {
    const prev = this.snapshot.value;
    if (!(shelfId in prev.stockings)) return;
    const next: Record<string, readonly AdmittedStocking[]> = {
      ...prev.stockings,
    };
    delete next[shelfId];
    this.snapshot.value = freezeSnapshot({
      shelves: prev.shelves,
      widgetKinds: prev.widgetKinds,
      stockings: next,
    });
  }

  /** Convenience: every known shelf id, sorted. */
  public shelfIds(): readonly string[] {
    return Object.keys(this.snapshot.value.shelves).sort();
  }

  public stockingsForShelf(shelfId: string): readonly AdmittedStocking[] {
    return this.snapshot.value.stockings[shelfId] ?? [];
  }
}

/**
 * Decode a `describe_ui_stockings` wire-op response into the
 * combined snapshot. Tolerates the additive nature of the response
 * (older servers without `shelves` / `widget_kinds` simply produce
 * empty maps; the renderer falls back to defaults).
 */
export function decodeUiSnapshot(raw: unknown): UiSnapshot {
  if (!isObject(raw)) return EMPTY_SNAPSHOT;
  return {
    shelves: decodeShelves(raw.shelves),
    widgetKinds: decodeWidgetKinds(raw.widget_kinds),
    stockings: decodeStockings(raw.entries),
  };
}

function decodeShelves(raw: unknown): { [id: string]: ShelfContract } {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, ShelfContract> = {};
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = stringField(entry, "id");
    if (id === null) continue;
    out[id] = {
      id,
      label: stringField(entry, "label") ?? undefined,
      cardinality:
        (stringField(entry, "cardinality") as ShelfCardinality | null) ??
        "any-to-many",
      acceptsWidgets: decodeAcceptedWidgets(entry.accepts_widgets),
      acceptsSizes: decodeSizes(entry.accepts_sizes),
      layout: (stringField(entry, "layout") as ShelfLayout | null) ?? "grid",
      orderBy:
        (stringField(entry, "order_by") as ShelfOrder | null) ??
        "manifest_declaration",
      defaultWidget: stringField(entry, "default_widget") ?? undefined,
      schemaVersion: numField(entry, "schema_version") ?? 1,
      minCompatibleVersion:
        numField(entry, "min_compatible_version") ?? undefined,
    };
  }
  return out;
}

function decodeAcceptedWidgets(raw: unknown): AcceptedWidgets {
  if (raw === "*") return { kind: "any" };
  if (isObject(raw)) {
    if ("any" in raw) return { kind: "any" };
    if ("allowed" in raw && Array.isArray(raw.allowed)) {
      return {
        kind: "allowed",
        patterns: raw.allowed.filter(
          (s): s is string => typeof s === "string",
        ),
      };
    }
  }
  if (Array.isArray(raw)) {
    return {
      kind: "allowed",
      patterns: raw.filter((s): s is string => typeof s === "string"),
    };
  }
  return { kind: "any" };
}

function decodeSizes(raw: unknown): readonly UiSize[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is UiSize =>
      typeof s === "string" &&
      ["atom", "quarter", "third", "half", "two-thirds", "full"].includes(s),
  );
}

function decodeWidgetKinds(raw: unknown): {
  [id: string]: WidgetKindEnvelope;
} {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, WidgetKindEnvelope> = {};
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = stringField(entry, "id");
    if (id === null) continue;
    out[id] = {
      id,
      minSize: (stringField(entry, "min_size") as UiSize | null) ?? "atom",
      idealSize:
        (stringField(entry, "ideal_size") as UiSize | null) ?? "third",
      maxSize: (stringField(entry, "max_size") as UiSize | null) ?? "full",
      aspectRatio:
        (stringField(entry, "aspect_ratio") as UiAspect | null) ?? "any",
      responsive: decodeResponsive(entry.responsive),
      mode: (stringField(entry, "mode") as UiMode | null) ?? "inline",
      schemaVersion: numField(entry, "schema_version") ?? 1,
    };
  }
  return out;
}

function decodeResponsive(raw: unknown): {
  [bp in UiBreakpoint]?: UiSize;
} {
  if (!isObject(raw)) return {};
  const out: { [bp in UiBreakpoint]?: UiSize } = {};
  for (const bp of ["compact", "regular", "wide"] as const) {
    const v = raw[bp];
    if (typeof v === "string") out[bp] = v as UiSize;
  }
  return out;
}

function decodeStockings(raw: unknown): StockingsByShelf {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, AdmittedStocking[]> = {};
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const plugin = stringField(entry, "plugin");
    const shelfId = stringField(entry, "ui_shelf");
    const widgetKindId = stringField(entry, "widget");
    if (plugin === null || shelfId === null || widgetKindId === null) continue;
    (out[shelfId] ??= []).push({
      plugin,
      shelfId,
      widgetKindId,
      size: stringField(entry, "size") ?? "third",
      mode: stringField(entry, "mode") ?? undefined,
      schemaVersion: numField(entry, "schema_version") ?? 1,
    });
  }
  return out;
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

function freezeSnapshot(snapshot: UiSnapshot): UiSnapshot {
  return Object.freeze({
    shelves: Object.freeze(snapshot.shelves),
    widgetKinds: Object.freeze(snapshot.widgetKinds),
    stockings: Object.freeze(snapshot.stockings),
  });
}
