// Layout document: the operator-owned arrangement of admitted
// widgets. Direction (builder v1): manifest stockings are
// *availability* — "this widget exists, with a suggested shelf" —
// while the layout document persisted in `ui.profile` owns
// *placement*. When no document is stored, `synthesizeLayoutDocument`
// expresses today's manifest-order composition as a document, so the
// shipped default is the same behavior in data form and nothing
// regresses on devices that never open the designer.
//
// Validation deliberately reuses the composition resolver's
// semantics (`pickSizeForDeclared`, `sizeWithinEnvelope`,
// `orderStockings`) so a document can never admit a placement the
// stocking path would refuse.
//
// Contract blocks (Tier 0): the landing rest contract is enforced as
// *presence locked, placement free*. Which widget kinds are contract
// blocks is injected by the caller (`contractKinds`) rather than
// hard-coded here — the Tier 0 kinds register alongside the rest of
// the registry and the set arrives from the same place. An empty set
// (the default until those kinds ship) makes the rule vacuous.
//
// Nav shedding is fold-model-owned: the document stores the menu's
// position and entries, and the fold model decides at which tier the
// menu folds into the pivot compass. The document does not override
// that — "no sidebar on small" stays a shell rule, not operator data.
//
// Wire shape: camelCase keys, matching the `ui.profile` container
// this document persists inside (see `ui-profile.ts`).

import { decodeStageDoc, type StageDoc } from "./stage-document.ts";

import {
  orderStockings,
  pickSizeForDeclared,
  sizeWithinEnvelope,
} from "./composition.ts";

import type {
  AdmittedStocking,
  UiBreakpoint,
  UiSize,
  UiSnapshot,
  WidgetKindEnvelope,
} from "./stockings.ts";

export const LAYOUT_SCHEMA_VERSION = 1;

export const LANDING_PAGE_ID = "landing";

/** Fold priority given to slots that do not declare one. */
export const DEFAULT_FOLD_PRIORITY: FoldPriority = 3;

/**
 * Shell-owned page regions. These are rendering regions inside a
 * page, not framework shelves — the framework shelf a stocking was
 * declared against survives on the slot as `sourceShelf` (its
 * availability grouping), while the region is where the operator
 * placed it.
 */
export type PageRegionId = "main" | "rail" | "deck";

export const PAGE_REGION_IDS: readonly PageRegionId[] = [
  "main",
  "rail",
  "deck",
];

export interface RegionContract {
  readonly acceptsSizes: readonly UiSize[];
}

/** Region contracts. The rail is a STACKED region: widgets render at
 *  the rail's width and their requested height, so size-gating it is
 *  meaningless - it accepts every size (the original atom/quarter
 *  gate made the rail unfillable by any real widget: dead region).
 *  The deck stays a low strip and keeps its gate. */
export const PAGE_REGIONS: { readonly [r in PageRegionId]: RegionContract } = {
  main: {
    acceptsSizes: ["atom", "quarter", "third", "half", "two-thirds", "full"],
  },
  rail: {
    acceptsSizes: ["atom", "quarter", "third", "half", "two-thirds", "full"],
  },
  deck: { acceptsSizes: ["atom", "quarter", "third"] },
};

export type FoldPriority = 1 | 2 | 3 | 4 | 5;

export type SlotAlign = "auto" | "left" | "center" | "right";

export type SlotTypeScale = "xs" | "s" | "m" | "l" | "xl";
export type SlotDensity = "compact" | "regular" | "comfortable";
export type SlotIconSize = "s" | "m" | "l";

/**
 * Curated per-instance style layer. Every field is a token-level
 * override the shell compiles into scoped custom properties — never
 * raw CSS. Absent fields inherit the profile/theme defaults.
 */
export interface SlotStyle {
  readonly type?: SlotTypeScale;
  readonly density?: SlotDensity;
  readonly icon?: SlotIconSize;
  /** Accent token override (hex) for this instance only. */
  readonly accent?: string;
}

export interface LayoutSlot {
  readonly widgetKindId: string;
  /** Owning plugin, when the availability entry declared one. */
  readonly plugin?: string;
  readonly size: UiSize;
  readonly foldPriority: FoldPriority;
  /** Row placement inside the 12-column main region. */
  readonly align?: SlotAlign;
  readonly style?: SlotStyle;
  /** Framework shelf the availability entry suggested. */
  readonly sourceShelf?: string;
}

export type RailPosition = "left" | "right" | "top" | "bottom" | "off";

export interface LayoutPage {
  readonly id: string;
  readonly name: string;
  readonly regions: { readonly [r in PageRegionId]?: readonly LayoutSlot[] };
  /** Where the rail sits. Default right; top/bottom render it as a
   *  horizontal band; "off" hides it on the device while its widgets
   *  stay in the layout (non-destructive - the designer still shows
   *  them). "Center" is a main-grid arrangement, not a rail
   *  position. */
  readonly railPosition?: RailPosition;
  /** Rail surface opacity 0..1 over the theme's card token. Default
   *  0 (transparent - the rail floats on the page background) stores
   *  nothing. Style only: geometry never varies with it. */
  readonly railOpacity?: number;
  /** Now-playing stage arrangement (rows -> cells -> atoms) for the
   *  page's stage host. Absent = CLASSIC_STAGE. */
  readonly stage?: StageDoc;
}

export type NavPosition = "left" | "right" | "bottom" | "none";

/** pinned = always visible; slide = drawer behind the menu button. */
export type NavMode = "pinned" | "slide";

export type NavEntry =
  | { readonly type: "page"; readonly page: string; readonly label?: string }
  | {
      readonly type: "widget";
      readonly page: string;
      readonly widgetKindId: string;
      readonly plugin?: string;
      readonly label?: string;
    }
  /** Starts a labelled menu group: entries after it belong to it
   *  until the next divider. Empty/absent label renders a plain
   *  rule. Older shells drop unknown entry types on decode, so
   *  dividers degrade to a flat menu - no schema bump needed. */
  | { readonly type: "divider"; readonly label?: string };

export interface LayoutNav {
  readonly position: NavPosition;
  /** Default pinned. Slide reuses the drawer affordance. */
  readonly mode?: NavMode;
  /** The power cluster (Power off / Reboot verbs at the sidebar
   *  foot). Default pinned; "hidden" removes it - full customisation
   *  means even safety chrome is the operator's call. Alarms/Update
   *  are ordinary curatable views, not part of this. */
  readonly power?: "pinned" | "hidden";
  readonly entries: readonly NavEntry[];
}

export interface LayoutDocument {
  readonly schemaVersion: number;
  readonly pages: readonly LayoutPage[];
  readonly nav: LayoutNav;
}

/* ------------------------------------------------------------------ */
/* Decode                                                              */
/* ------------------------------------------------------------------ */

const UI_SIZES: readonly UiSize[] = [
  "atom",
  "quarter",
  "third",
  "half",
  "two-thirds",
  "full",
];

/**
 * Tolerant decode of a persisted layout document. Returns `null`
 * when the value is not a document at all or was written by a newer
 * schema than this shell understands (never guess at future
 * semantics). Individually malformed slots / entries are dropped;
 * malformed optional fields fall back to defaults.
 */
export function decodeLayoutDocument(raw: unknown): LayoutDocument | null {
  if (!isObject(raw)) return null;
  const schemaVersion = numField(raw, "schemaVersion") ?? 1;
  if (schemaVersion > LAYOUT_SCHEMA_VERSION) return null;
  if (!Array.isArray(raw.pages)) return null;

  const pages: LayoutPage[] = [];
  const seen = new Set<string>();
  for (const entry of raw.pages) {
    const page = decodePage(entry);
    if (page === null || seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
  }
  if (pages.length === 0) return null;

  return {
    schemaVersion,
    pages,
    nav: decodeNav(raw.nav),
  };
}

function decodePage(raw: unknown): LayoutPage | null {
  if (!isObject(raw)) return null;
  const id = stringField(raw, "id");
  if (id === null || id.length === 0) return null;
  const regionsRaw = isObject(raw.regions) ? raw.regions : {};
  const regions: { [r in PageRegionId]?: readonly LayoutSlot[] } = {};
  for (const region of PAGE_REGION_IDS) {
    const slotsRaw = regionsRaw[region];
    if (!Array.isArray(slotsRaw)) continue;
    const slots: LayoutSlot[] = [];
    for (const slotRaw of slotsRaw) {
      const slot = decodeSlot(slotRaw);
      if (slot !== null) slots.push(slot);
    }
    regions[region] = slots;
  }
  const railPosition = stringField(raw, "railPosition");
  const railOpacityRaw = numField(raw, "railOpacity");
  const railOpacity =
    railOpacityRaw !== null ? Math.min(1, Math.max(0, railOpacityRaw)) : null;
  const stage = decodeStageDoc(raw.stage);
  return {
    id,
    name: stringField(raw, "name") ?? id,
    regions,
    ...(isOneOf(railPosition, ["left", "right", "top", "bottom", "off"] as const)
      ? { railPosition }
      : {}),
    ...(railOpacity !== null && railOpacity > 0 ? { railOpacity } : {}),
    ...(stage !== null ? { stage } : {}),
  };
}

function decodeSlot(raw: unknown): LayoutSlot | null {
  if (!isObject(raw)) return null;
  const widgetKindId = stringField(raw, "widgetKindId");
  const size = stringField(raw, "size");
  if (widgetKindId === null || !isUiSize(size)) return null;
  const align = stringField(raw, "align");
  const style = decodeStyle(raw.style);
  return {
    widgetKindId,
    plugin: stringField(raw, "plugin") ?? undefined,
    size,
    foldPriority: decodeFoldPriority(raw.foldPriority),
    ...(isSlotAlign(align) && align !== "auto" ? { align } : {}),
    ...(style !== null ? { style } : {}),
    sourceShelf: stringField(raw, "sourceShelf") ?? undefined,
  };
}

function decodeFoldPriority(raw: unknown): FoldPriority {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const clamped = Math.min(5, Math.max(1, Math.round(raw)));
    return clamped as FoldPriority;
  }
  return DEFAULT_FOLD_PRIORITY;
}

function decodeStyle(raw: unknown): SlotStyle | null {
  if (!isObject(raw)) return null;
  const type = stringField(raw, "type");
  const density = stringField(raw, "density");
  const icon = stringField(raw, "icon");
  const accent = stringField(raw, "accent");
  const out: SlotStyle = {
    ...(isOneOf(type, ["xs", "s", "m", "l", "xl"] as const)
      ? { type }
      : {}),
    ...(isOneOf(density, ["compact", "regular", "comfortable"] as const)
      ? { density }
      : {}),
    ...(isOneOf(icon, ["s", "m", "l"] as const) ? { icon } : {}),
    ...(accent !== null && /^#[0-9a-fA-F]{6}$/.test(accent)
      ? { accent }
      : {}),
  };
  return Object.keys(out).length > 0 ? out : null;
}

function decodeNav(raw: unknown): LayoutNav {
  const fallback: LayoutNav = { position: "left", entries: [] };
  if (!isObject(raw)) return fallback;
  const position = stringField(raw, "position");
  const entries: NavEntry[] = [];
  if (Array.isArray(raw.entries)) {
    for (const entryRaw of raw.entries) {
      const entry = decodeNavEntry(entryRaw);
      if (entry !== null) entries.push(entry);
    }
  }
  const mode = stringField(raw, "mode");
  const power = stringField(raw, "power");
  return {
    position: isOneOf(position, ["left", "right", "bottom", "none"] as const)
      ? position
      : "left",
    ...(mode === "slide" ? { mode: "slide" as const } : {}),
    ...(power === "hidden" ? { power: "hidden" as const } : {}),
    entries,
  };
}

function decodeNavEntry(raw: unknown): NavEntry | null {
  if (!isObject(raw)) return null;
  const type = stringField(raw, "type");
  const label = stringField(raw, "label") ?? undefined;
  if (type === "divider") {
    return { type: "divider", ...(label !== undefined ? { label } : {}) };
  }
  const page = stringField(raw, "page");
  if (page === null) return null;
  if (type === "page") {
    return { type: "page", page, ...(label !== undefined ? { label } : {}) };
  }
  if (type === "widget") {
    const widgetKindId = stringField(raw, "widgetKindId");
    if (widgetKindId === null) return null;
    return {
      type: "widget",
      page,
      widgetKindId,
      plugin: stringField(raw, "plugin") ?? undefined,
      ...(label !== undefined ? { label } : {}),
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Synthesis: manifest availability -> default document               */
/* ------------------------------------------------------------------ */

export interface SynthesisOptions {
  /** Widget kinds whose presence on landing is contract-locked. */
  readonly contractKinds?: ReadonlySet<string>;
}

/**
 * Express the manifest-order composition as a layout document: one
 * landing page whose `main` region carries every admitted stocking,
 * shelf by shelf (shelf ids sorted, each shelf's own `order_by`
 * honoured), sizes as declared. This is the document the shell uses
 * when the operator has never opened the designer — behaviorally
 * identical to the pre-document composition path.
 */
export function synthesizeLayoutDocument(
  snapshot: UiSnapshot,
  options?: SynthesisOptions,
): LayoutDocument {
  const contractKinds = options?.contractKinds ?? new Set<string>();
  const slots: LayoutSlot[] = [];
  for (const shelfId of Object.keys(snapshot.shelves).sort()) {
    const contract = snapshot.shelves[shelfId];
    const stockings = snapshot.stockings[shelfId] ?? [];
    const ordered = orderStockings(contract.orderBy, stockings);
    for (const stocking of ordered) {
      slots.push(slotFromStocking(stocking, contractKinds));
    }
  }
  // Stockings on shelves without a declared contract still render
  // today; keep them in the default document too.
  for (const shelfId of Object.keys(snapshot.stockings).sort()) {
    if (shelfId in snapshot.shelves) continue;
    for (const stocking of snapshot.stockings[shelfId]) {
      slots.push(slotFromStocking(stocking, contractKinds));
    }
  }
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    pages: [
      {
        id: LANDING_PAGE_ID,
        name: "Landing",
        regions: { main: slots },
      },
    ],
    nav: {
      position: "left",
      entries: [{ type: "page", page: LANDING_PAGE_ID }],
    },
  };
}

function slotFromStocking(
  stocking: AdmittedStocking,
  contractKinds: ReadonlySet<string>,
): LayoutSlot {
  return {
    widgetKindId: stocking.widgetKindId,
    plugin: stocking.plugin,
    size: isUiSize(stocking.size) ? stocking.size : "third",
    foldPriority: contractKinds.has(stocking.widgetKindId)
      ? 5
      : DEFAULT_FOLD_PRIORITY,
    sourceShelf: stocking.shelfId,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type LayoutIssueKind =
  | "missing-landing"
  | "unknown-widget-kind"
  | "size-outside-envelope"
  | "size-outside-region"
  | "contract-off-landing"
  | "contract-missing"
  | "nav-dead-page"
  | "nav-dead-widget";

export interface LayoutIssue {
  readonly kind: LayoutIssueKind;
  readonly reason: string;
  readonly pageId?: string;
  readonly region?: PageRegionId;
  readonly widgetKindId?: string;
}

export interface LayoutValidation {
  readonly ok: boolean;
  readonly issues: readonly LayoutIssue[];
}

/**
 * Validate a document against the current availability snapshot.
 * Issues are advisory for the designer (which surfaces them) and for
 * the renderer's resolve step (which refuses the affected slot, not
 * the whole document). A document with issues still renders — the
 * explicit-refusal posture from `composition.ts` carries over.
 */
export function validateLayoutDocument(
  doc: LayoutDocument,
  snapshot: UiSnapshot,
  contractKinds: ReadonlySet<string> = new Set(),
): LayoutValidation {
  const issues: LayoutIssue[] = [];

  const landing = doc.pages.find((p) => p.id === LANDING_PAGE_ID);
  if (landing === undefined) {
    issues.push({
      kind: "missing-landing",
      reason: `document has no '${LANDING_PAGE_ID}' page`,
    });
  }

  const placedContractKinds = new Set<string>();
  for (const page of doc.pages) {
    for (const region of PAGE_REGION_IDS) {
      const slots = page.regions[region] ?? [];
      for (const slot of slots) {
        if (contractKinds.has(slot.widgetKindId)) {
          placedContractKinds.add(slot.widgetKindId);
          if (page.id !== LANDING_PAGE_ID) {
            issues.push({
              kind: "contract-off-landing",
              reason: `Tier 0 block ${slot.widgetKindId} must remain on the landing rest`,
              pageId: page.id,
              region,
              widgetKindId: slot.widgetKindId,
            });
          }
        }
        const envelope = snapshot.widgetKinds[slot.widgetKindId];
        if (envelope === undefined) {
          issues.push({
            kind: "unknown-widget-kind",
            reason: `widget kind ${slot.widgetKindId} is not in the current availability snapshot`,
            pageId: page.id,
            region,
            widgetKindId: slot.widgetKindId,
          });
        } else if (!sizeWithinEnvelope(slot.size, envelope)) {
          issues.push({
            kind: "size-outside-envelope",
            reason: `size ${slot.size} outside envelope ${envelope.minSize}..${envelope.maxSize} for ${slot.widgetKindId}`,
            pageId: page.id,
            region,
            widgetKindId: slot.widgetKindId,
          });
        }
        if (!PAGE_REGIONS[region].acceptsSizes.includes(slot.size)) {
          issues.push({
            kind: "size-outside-region",
            reason: `region '${region}' accepts [${PAGE_REGIONS[region].acceptsSizes.join(", ")}], slot declares ${slot.size}`,
            pageId: page.id,
            region,
            widgetKindId: slot.widgetKindId,
          });
        }
      }
    }
  }

  for (const kind of contractKinds) {
    if (!placedContractKinds.has(kind)) {
      issues.push({
        kind: "contract-missing",
        reason: `Tier 0 block ${kind} is absent from the document`,
        widgetKindId: kind,
      });
    }
  }

  const pageIds = new Set(doc.pages.map((p) => p.id));
  for (const entry of doc.nav.entries) {
    if (entry.type === "divider") {
      // Dividers reference nothing - grouping chrome, always valid.
      continue;
    }
    if (!pageIds.has(entry.page)) {
      issues.push({
        kind: entry.type === "page" ? "nav-dead-page" : "nav-dead-widget",
        reason: `nav entry references unknown page '${entry.page}'`,
        pageId: entry.page,
      });
      continue;
    }
    if (entry.type === "widget") {
      const page = doc.pages.find((p) => p.id === entry.page);
      const found =
        page !== undefined &&
        PAGE_REGION_IDS.some((region) =>
          (page.regions[region] ?? []).some(
            (slot) =>
              slot.widgetKindId === entry.widgetKindId &&
              (entry.plugin === undefined || slot.plugin === entry.plugin),
          ),
        );
      if (!found) {
        issues.push({
          kind: "nav-dead-widget",
          reason: `nav entry links ${entry.widgetKindId} which is not placed on page '${entry.page}'`,
          pageId: entry.page,
          widgetKindId: entry.widgetKindId,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedSlotStatus =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ResolvedSlot {
  readonly slot: LayoutSlot;
  readonly effectiveSize: UiSize;
  readonly status: ResolvedSlotStatus;
}

export interface ResolvedPage {
  readonly page: LayoutPage;
  readonly regions: {
    readonly [r in PageRegionId]?: readonly ResolvedSlot[];
  };
}

export interface ResolvedLayout {
  readonly pages: readonly ResolvedPage[];
  readonly nav: LayoutNav;
}

/**
 * Resolve a document for rendering: per slot, the effective size at
 * the current breakpoint (same envelope semantics as the stocking
 * resolver) and an explicit status.
 *
 * Availability is the *stocking* — the framework's per-instance
 * grant — not merely the widget-kind envelope. The budget scope is
 * PER PAGE: pages render one at a time, so the same widget may live
 * on any number of pages; within one page, slots beyond the funded
 * count resolve `unavailable`. The display renderer skips those
 * silently; the designer shows them as ghosts so the arrangement
 * survives a plugin's round trip.
 *
 * Refused slots (region or envelope violations) do not consume an
 * instance — a slot that cannot render must not starve a legal one.
 */
export function resolveLayout(
  doc: LayoutDocument,
  snapshot: UiSnapshot,
  breakpoint: UiBreakpoint,
): ResolvedLayout {
  return {
    pages: doc.pages.map((page) => {
      const budget = availabilityBudget(snapshot);
      return {
        page,
        regions: Object.fromEntries(
          PAGE_REGION_IDS.filter((r) => page.regions[r] !== undefined).map(
            (region) => [
              region,
              (page.regions[region] ?? []).map((slot) =>
                resolveSlot(slot, region, snapshot, breakpoint, budget),
              ),
            ],
          ),
        ),
      };
    }),
    nav: doc.nav,
  };
}

/** Multiset of admitted stockings: widget kind id -> owning plugins. */
function availabilityBudget(snapshot: UiSnapshot): Map<string, string[]> {
  const budget = new Map<string, string[]>();
  for (const shelfId of Object.keys(snapshot.stockings)) {
    for (const stocking of snapshot.stockings[shelfId]) {
      const plugins = budget.get(stocking.widgetKindId);
      if (plugins === undefined) {
        budget.set(stocking.widgetKindId, [stocking.plugin]);
      } else {
        plugins.push(stocking.plugin);
      }
    }
  }
  return budget;
}

/** Consume one funded instance for the slot; false when exhausted. */
function consumeBudget(
  budget: Map<string, string[]>,
  slot: LayoutSlot,
): boolean {
  const plugins = budget.get(slot.widgetKindId);
  if (plugins === undefined || plugins.length === 0) return false;
  if (slot.plugin === undefined) {
    plugins.pop();
    return true;
  }
  const i = plugins.indexOf(slot.plugin);
  if (i < 0) return false;
  plugins.splice(i, 1);
  return true;
}

function resolveSlot(
  slot: LayoutSlot,
  region: PageRegionId,
  snapshot: UiSnapshot,
  breakpoint: UiBreakpoint,
  budget: Map<string, string[]>,
): ResolvedSlot {
  const envelope: WidgetKindEnvelope | undefined =
    snapshot.widgetKinds[slot.widgetKindId];
  if (envelope === undefined) {
    return {
      slot,
      effectiveSize: slot.size,
      status: {
        kind: "unavailable",
        reason: `widget kind ${slot.widgetKindId} is not currently available`,
      },
    };
  }
  if (!PAGE_REGIONS[region].acceptsSizes.includes(slot.size)) {
    return {
      slot,
      effectiveSize: slot.size,
      status: {
        kind: "refused",
        reason: `region '${region}' does not accept size ${slot.size}`,
      },
    };
  }
  if (!sizeWithinEnvelope(slot.size, envelope)) {
    return {
      slot,
      effectiveSize: slot.size,
      status: {
        kind: "refused",
        reason: `widget envelope refuses size ${slot.size} (envelope ${envelope.minSize}..${envelope.maxSize})`,
      },
    };
  }
  if (!consumeBudget(budget, slot)) {
    return {
      slot,
      effectiveSize: slot.size,
      status: {
        kind: "unavailable",
        reason: `no admitted stocking funds ${slot.widgetKindId}${slot.plugin !== undefined ? ` from ${slot.plugin}` : ""}`,
      },
    };
  }
  return {
    slot,
    effectiveSize: pickSizeForDeclared(slot.size, envelope, breakpoint),
    status: { kind: "admitted" },
  };
}

/* ------------------------------------------------------------------ */
/* Fold shedding                                                       */
/* ------------------------------------------------------------------ */

export interface ShedResult {
  readonly visible: readonly ResolvedSlot[];
  readonly shed: readonly ResolvedSlot[];
}

/**
 * Apply fold shedding to a resolved region: slots below the tier's
 * minimum priority shed, lowest priority first by construction.
 * Contract blocks never shed regardless of tier.
 */
export function shedAtTier(
  slots: readonly ResolvedSlot[],
  minPriority: number,
  contractKinds: ReadonlySet<string> = new Set(),
): ShedResult {
  const visible: ResolvedSlot[] = [];
  const shed: ResolvedSlot[] = [];
  for (const resolved of slots) {
    const isContract = contractKinds.has(resolved.slot.widgetKindId);
    if (isContract || resolved.slot.foldPriority >= minPriority) {
      visible.push(resolved);
    } else {
      shed.push(resolved);
    }
  }
  return { visible, shed };
}

/* ------------------------------------------------------------------ */
/* Availability merge                                                  */
/* ------------------------------------------------------------------ */

export interface MergeResult {
  readonly doc: LayoutDocument;
  /** Widget kind ids appended to the landing main region. */
  readonly appended: readonly string[];
}

/**
 * Reconcile a stored document with the current availability
 * snapshot. Newly admitted stockings the document has never seen are
 * appended to the landing `main` region with defaults, so a plugin
 * installed after the operator arranged their layout still surfaces
 * without any designer action. Slots referencing withdrawn
 * availability are kept — the resolver marks them `unavailable`, and
 * they come back in place when the plugin returns.
 *
 * Matching is count-based per (plugin, widgetKindId): if availability
 * carries more instances than the document references, the surplus is
 * appended.
 */
export function mergeAvailability(
  doc: LayoutDocument,
  snapshot: UiSnapshot,
  options?: SynthesisOptions,
): MergeResult {
  const contractKinds = options?.contractKinds ?? new Set<string>();
  const referenced = new Map<string, number>();
  for (const page of doc.pages) {
    for (const region of PAGE_REGION_IDS) {
      for (const slot of page.regions[region] ?? []) {
        const key = slotKey(slot.plugin, slot.widgetKindId);
        referenced.set(key, (referenced.get(key) ?? 0) + 1);
      }
    }
  }

  const appendedSlots: LayoutSlot[] = [];
  for (const shelfId of Object.keys(snapshot.stockings).sort()) {
    for (const stocking of snapshot.stockings[shelfId]) {
      const key = slotKey(stocking.plugin, stocking.widgetKindId);
      const remaining = referenced.get(key) ?? 0;
      if (remaining > 0) {
        referenced.set(key, remaining - 1);
      } else {
        appendedSlots.push(slotFromStocking(stocking, contractKinds));
      }
    }
  }

  if (appendedSlots.length === 0) {
    return { doc, appended: [] };
  }

  const pages = doc.pages.map((page) => {
    if (page.id !== LANDING_PAGE_ID) return page;
    return {
      ...page,
      regions: {
        ...page.regions,
        main: [...(page.regions.main ?? []), ...appendedSlots],
      },
    };
  });
  // A document without a landing page is invalid but still renders;
  // append availability to the first page rather than losing it.
  const hasLanding = doc.pages.some((p) => p.id === LANDING_PAGE_ID);
  const mergedPages = hasLanding
    ? pages
    : pages.map((page, i) =>
        i === 0
          ? {
              ...page,
              regions: {
                ...page.regions,
                main: [...(page.regions.main ?? []), ...appendedSlots],
              },
            }
          : page,
      );

  return {
    doc: { ...doc, pages: mergedPages },
    appended: appendedSlots.map((s) => s.widgetKindId),
  };
}

/** Separator written as an ESCAPE, never a literal byte: a raw
 *  control byte in source flips the whole file to "binary" for
 *  grep/ripgrep and silently blinds text tooling (found the hard
 *  way). NUL cannot occur in plugin or widget-kind ids, so the key
 *  is collision-free. */
function slotKey(plugin: string | undefined, widgetKindId: string): string {
  return [plugin ?? "", widgetKindId].join("");
}

/* ---------------------------------------------------------------- */
/* Decode helpers - house style, mirrors stockings.ts                */
/* ---------------------------------------------------------------- */

function isUiSize(v: unknown): v is UiSize {
  return typeof v === "string" && (UI_SIZES as readonly string[]).includes(v);
}

function isSlotAlign(v: unknown): v is SlotAlign {
  return v === "auto" || v === "left" || v === "center" || v === "right";
}

function isOneOf<T extends string>(
  v: string | null,
  values: readonly T[],
): v is T {
  return v !== null && (values as readonly string[]).includes(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  return typeof v === "string" ? v : null;
}

function numField(raw: Record<string, unknown>, key: string): number | null {
  const v = raw[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
