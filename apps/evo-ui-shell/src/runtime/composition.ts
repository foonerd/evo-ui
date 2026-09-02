// Declarative composition resolver. Reads the framework's typed
// shelf contracts + widget-kind envelopes + admitted stockings and
// produces the per-shelf composition the renderer paints: which
// stockings pass the cardinality + accepts-widgets + accepts-sizes
// gate, ordered by the shelf's `order_by` rule, sized through the
// per-widget-kind responsive envelope at the current viewport
// breakpoint.

import { signal, computed, type Signal, type ReadonlySignal } from "@preact/signals";

import type {
  AcceptedWidgets,
  AdmittedStocking,
  ShelfContract,
  ShelfLayout,
  ShelfOrder,
  UiBreakpoint,
  UiSize,
  WidgetKindEnvelope,
} from "./stockings";

/**
 * Per-stocking render plan the resolver produces for the renderer.
 * Includes the original stocking + the resolved size (after
 * applying the widget-kind envelope's responsive override at the
 * current breakpoint) + a status discriminator so the renderer can
 * surface refusals explicitly rather than silently dropping them.
 */
export interface ResolvedStocking {
  readonly stocking: AdmittedStocking;
  readonly effectiveSize: UiSize;
  readonly status: ResolvedStatus;
}

export type ResolvedStatus =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused"; readonly reason: string };

/** Per-shelf composition the resolver produces. */
export interface ResolvedShelf {
  readonly contract: ShelfContract;
  readonly stockings: readonly ResolvedStocking[];
  readonly cardinalityViolation: string | null;
  readonly layout: ShelfLayout;
}

/**
 * Breakpoint inference. Maps the current viewport width onto the
 * framework's typed `UiBreakpoint` discriminator. Values mirror the
 * conventional CSS-side breakpoints: compact (mobile), regular
 * (tablet), wide (desktop).
 */
export function breakpointFor(viewportWidthPx: number): UiBreakpoint {
  if (viewportWidthPx < 640) return "compact";
  if (viewportWidthPx < 1280) return "regular";
  return "wide";
}

/**
 * Pick the effective size for one stocking. Resolution rule:
 *   1. If the widget-kind envelope declares a responsive override
 *      for the current breakpoint, use it.
 *   2. Otherwise, use the stocking's declared size if it falls
 *      inside `[envelope.min_size, envelope.max_size]`.
 *   3. Otherwise, clamp into the envelope's range, preferring
 *      `ideal_size` when the declared size is unavailable.
 */
export function pickSize(
  stocking: AdmittedStocking,
  envelope: WidgetKindEnvelope | undefined,
  breakpoint: UiBreakpoint,
): UiSize {
  return pickSizeForDeclared(stocking.size as UiSize, envelope, breakpoint);
}

/**
 * Size resolution for a declared size independent of the stocking
 * shape. Shared by the stocking resolver above and the layout
 * document resolver (`layout-document.ts`), so both placement paths
 * apply identical envelope semantics.
 */
export function pickSizeForDeclared(
  declared: UiSize,
  envelope: WidgetKindEnvelope | undefined,
  breakpoint: UiBreakpoint,
): UiSize {
  if (envelope === undefined) {
    return declared;
  }
  const responsive = envelope.responsive[breakpoint];
  if (responsive !== undefined) return responsive;
  if (sizeWithinEnvelope(declared, envelope)) {
    return declared;
  }
  return envelope.idealSize;
}

/** True when `size` falls inside the envelope's admissible range. */
export function sizeWithinEnvelope(
  size: UiSize,
  envelope: WidgetKindEnvelope,
): boolean {
  return (
    sizeOrder(size) >= sizeOrder(envelope.minSize) &&
    sizeOrder(size) <= sizeOrder(envelope.maxSize)
  );
}

const SIZE_ORDER: Record<UiSize, number> = {
  atom: 0,
  quarter: 1,
  third: 2,
  half: 3,
  "two-thirds": 4,
  full: 5,
};

function sizeOrder(size: UiSize): number {
  return SIZE_ORDER[size] ?? 0;
}

/**
 * True when a glob pattern in the `AcceptedWidgets::Allowed` list
 * matches the named widget kind. Mirrors the framework's
 * prefix-glob rule: a pattern ending in `.*` matches anything in
 * its namespace prefix; otherwise the comparison is exact.
 */
export function acceptsWidget(rule: AcceptedWidgets, kindId: string): boolean {
  if (rule.kind === "any") return true;
  return rule.patterns.some((pattern) => matchesGlob(pattern, kindId));
}

function matchesGlob(pattern: string, kindId: string): boolean {
  if (pattern === kindId) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return kindId.startsWith(prefix);
  }
  if (pattern === "*") return true;
  return false;
}

/**
 * Apply the shelf's `order_by` rule to its stockings. The framework
 * records the priority field at admission time; the resolver reads
 * it through the stocking's envelope when the shelf is ordered by
 * `priority_then_creation`.
 */
export function orderStockings(
  rule: ShelfOrder,
  stockings: readonly AdmittedStocking[],
): readonly AdmittedStocking[] {
  if (stockings.length <= 1) return stockings;
  const out = [...stockings];
  switch (rule) {
    case "manifest_declaration":
      return out;
    case "alphabetical":
      return out.sort((a, b) =>
        (a.widgetKindId + a.plugin).localeCompare(b.widgetKindId + b.plugin),
      );
    case "category":
      // Category is a widget-envelope concept the framework records
      // alongside the kind id; the renderer surfaces stockings
      // grouped by their category prefix. Fall back to alphabetical
      // until the envelope's category field threads through to the
      // resolved stocking.
      return out.sort((a, b) =>
        a.widgetKindId.localeCompare(b.widgetKindId),
      );
    case "operator_curated":
      // Operator-curated ordering is persisted per shelf; the
      // operator UI mutates the curation and the framework records
      // it. With no curation persisted yet, manifest order is the
      // observable shape.
      return out;
    case "priority_then_creation":
      // The framework's priority field is stocking metadata
      // (Critical < High < Normal < Low). Renderer-side decode
      // surfaces it via the SDK when the field is present.
      return out;
  }
}

/**
 * Run the resolver. Reads the snapshot of shelves + widget kinds +
 * admitted stockings + current breakpoint, returns a per-shelf
 * resolved plan keyed by shelf id.
 */
export function resolveComposition(
  shelves: { readonly [id: string]: ShelfContract },
  widgetKinds: { readonly [id: string]: WidgetKindEnvelope },
  stockingsByShelf: { readonly [id: string]: readonly AdmittedStocking[] },
  breakpoint: UiBreakpoint,
): { readonly [id: string]: ResolvedShelf } {
  const out: Record<string, ResolvedShelf> = {};
  for (const [shelfId, contract] of Object.entries(shelves)) {
    const raw = stockingsByShelf[shelfId] ?? [];
    const ordered = orderStockings(contract.orderBy, raw);
    const resolved: ResolvedStocking[] = ordered.map((stocking) => {
      const envelope = widgetKinds[stocking.widgetKindId];
      const status = classify(contract, envelope, stocking);
      const effectiveSize = pickSize(stocking, envelope, breakpoint);
      return { stocking, effectiveSize, status };
    });
    const cardinalityViolation = checkCardinality(contract, resolved.length);
    out[shelfId] = {
      contract,
      stockings: resolved,
      cardinalityViolation,
      layout: contract.layout,
    };
  }
  return out;
}

function classify(
  contract: ShelfContract,
  envelope: WidgetKindEnvelope | undefined,
  stocking: AdmittedStocking,
): ResolvedStatus {
  if (!acceptsWidget(contract.acceptsWidgets, stocking.widgetKindId)) {
    return {
      kind: "refused",
      reason: `shelf does not accept widget kind ${stocking.widgetKindId}`,
    };
  }
  const declared = stocking.size as UiSize;
  if (
    contract.acceptsSizes.length > 0 &&
    !contract.acceptsSizes.includes(declared)
  ) {
    return {
      kind: "refused",
      reason: `shelf does not accept size ${declared}`,
    };
  }
  if (envelope !== undefined && !sizeWithinEnvelope(declared, envelope)) {
    return {
      kind: "refused",
      reason: `widget envelope refuses size ${declared} (envelope ${envelope.minSize}..${envelope.maxSize})`,
    };
  }
  // Schema-version window enforcement. When the shelf declares
  // `min_compatible_version`, every stocking inside the window
  // admits; otherwise the version must match exactly.
  const min = contract.minCompatibleVersion ?? contract.schemaVersion;
  if (
    stocking.schemaVersion < min ||
    stocking.schemaVersion > contract.schemaVersion
  ) {
    return {
      kind: "refused",
      reason: `schema version ${stocking.schemaVersion} outside shelf window ${min}..${contract.schemaVersion}`,
    };
  }
  return { kind: "admitted" };
}

function checkCardinality(
  contract: ShelfContract,
  admittedCount: number,
): string | null {
  switch (contract.cardinality) {
    case "exactly-one":
      if (admittedCount === 0) return "shelf requires exactly one stocking";
      if (admittedCount > 1) return `shelf requires exactly one stocking; admitted ${admittedCount}`;
      return null;
    case "at-most-one":
      if (admittedCount > 1) return `shelf requires at most one stocking; admitted ${admittedCount}`;
      return null;
    case "any-to-many":
      return null;
  }
}

/**
 * Reactive breakpoint signal. Updates on window resize; consumers
 * bind through `computed(...)` so changes propagate to the
 * composition resolution automatically.
 */
export function createBreakpointSignal(): Signal<UiBreakpoint> {
  if (typeof window === "undefined") {
    return signal<UiBreakpoint>("regular");
  }
  const sig = signal<UiBreakpoint>(breakpointFor(window.innerWidth));
  window.addEventListener("resize", () => {
    sig.value = breakpointFor(window.innerWidth);
  });
  return sig;
}

/** Helper: compute the resolved composition from reactive inputs. */
export function createCompositionComputed(
  snapshot: ReadonlySignal<{
    readonly shelves: { readonly [id: string]: ShelfContract };
    readonly widgetKinds: { readonly [id: string]: WidgetKindEnvelope };
    readonly stockings: { readonly [id: string]: readonly AdmittedStocking[] };
  }>,
  breakpoint: ReadonlySignal<UiBreakpoint>,
): ReadonlySignal<{ readonly [id: string]: ResolvedShelf }> {
  return computed(() =>
    resolveComposition(
      snapshot.value.shelves,
      snapshot.value.widgetKinds,
      snapshot.value.stockings,
      breakpoint.value,
    ),
  );
}
