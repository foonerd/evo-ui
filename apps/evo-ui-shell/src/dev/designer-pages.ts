// Designer pages editor - pure model. The Pages tab creates and
// arranges operator-defined layout pages: add / rename / remove a
// page, place catalog widgets on its main region, resize within the
// widget envelope, reorder, remove. Every operation is document ->
// document; the component commits results into the presentation
// profile and the footer Apply persists.
//
// Menu backfill invariant: surfacing the first page entry into a
// document whose menu is uncurated would collapse the sidebar to
// "Home + new page" (absent entries mean hidden). To keep adding a
// page a purely additive act, `addPage` backfills the full default
// menu before appending the new page's entry.
//
// The landing page is not editable here: the device's home surface
// is not document-driven yet, and offering an editor for it would be
// an affordance into a no-op.

import type { CuratableNavItem } from "../app/nav-curation.ts";
import {
  DEFAULT_HOME_PAGE,
  type AppWidgetKind,
  type ViewPageDefault
} from "../app/widget-catalog.ts";

import {
  DEFAULT_FOLD_PRIORITY,
  LANDING_PAGE_ID,
  LAYOUT_SCHEMA_VERSION,
  PAGE_REGIONS,
  type FoldPriority,
  type LayoutDocument,
  type LayoutPage,
  type LayoutSlot,
  type PageRegionId,
  type RailPosition,
  type SlotAlign,
} from "../runtime/layout-document.ts";

import type { UiSize } from "../runtime/stockings.ts";

/** Address of one placed widget inside a page. */
export interface SlotAddress {
  readonly region: PageRegionId;
  readonly index: number;
}

/** Minimal valid document to grow edits from. */
export function baseDocument(): LayoutDocument {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    pages: [{ id: LANDING_PAGE_ID, name: "Landing", regions: {} }],
    nav: { position: "left", entries: [] },
  };
}

/** Pages the editor may touch - everything except the landing. */
export function editablePages(doc: LayoutDocument | null): readonly LayoutPage[] {
  return (doc?.pages ?? []).filter((page) => page.id !== LANDING_PAGE_ID);
}

export interface AddPageResult {
  readonly doc: LayoutDocument;
  readonly pageId: string;
}

/**
 * Add a page and surface it in the menu. When the document's menu is
 * uncurated (no page entries), the full default menu is backfilled
 * first so the sidebar stays complete.
 */
export function addPage(
  doc: LayoutDocument | null,
  name: string,
  menuDefaults: readonly CuratableNavItem[],
): AddPageResult {
  const base = doc ?? baseDocument();
  const pageId = nextPageId(base);
  const trimmed = name.trim();
  const page: LayoutPage = {
    id: pageId,
    name: trimmed.length > 0 ? trimmed : "Page",
    regions: { main: [] },
  };
  const hasPageEntries = base.nav.entries.some((e) => e.type === "page");
  const backfill = hasPageEntries
    ? base.nav.entries
    : [
        ...menuDefaults.map((item) => ({
          type: "page" as const,
          page: item.id as string,
        })),
        ...base.nav.entries,
      ];
  return {
    doc: {
      ...base,
      pages: [...base.pages, page],
      nav: {
        ...base.nav,
        entries: [...backfill, { type: "page", page: pageId }],
      },
    },
    pageId,
  };
}

function nextPageId(doc: LayoutDocument): string {
  let n = 1;
  while (doc.pages.some((page) => page.id === `page-${n}`)) n += 1;
  return `page-${n}`;
}

/**
 * Copy-on-write default page for a built-in view: the view's single
 * widget at full width, under the view's own id so curation replaces
 * the view with the page. Idempotent - an existing override page is
 * returned as-is. No nav changes: the view's menu entry (explicit or
 * default) resolves to the page automatically once it exists.
 */
export function synthesizeViewPage(
  doc: LayoutDocument | null,
  def: ViewPageDefault,
): AddPageResult {
  const base = doc ?? baseDocument();
  if (base.pages.some((page) => page.id === def.viewId)) {
    return { doc: base, pageId: def.viewId };
  }
  const page: LayoutPage = {
    id: def.viewId,
    name: def.name,
    regions: {
      main: [
        {
          widgetKindId: def.widgetKindId,
          size: "full",
          foldPriority: DEFAULT_FOLD_PRIORITY,
        },
      ],
    },
  };
  return {
    doc: { ...base, pages: [...base.pages, page] },
    pageId: def.viewId,
  };
}

/**
 * Remove a page. Landing refuses. `keepEntries` preserves the menu
 * entries carrying the page's id - required when removing a
 * view-override page (library, works, home, ...): the built-in view
 * returns and must keep its menu position.
 */
export function removePage(
  doc: LayoutDocument,
  pageId: string,
  keepEntries = false,
): LayoutDocument {
  if (pageId === LANDING_PAGE_ID) return doc;
  return {
    ...doc,
    pages: doc.pages.filter((page) => page.id !== pageId),
    nav: {
      ...doc.nav,
      entries: keepEntries
        ? doc.nav.entries
        : doc.nav.entries.filter(
            // Dividers reference no page and always survive page removal.
            (entry) => entry.type === "divider" || entry.page !== pageId,
          ),
    },
  };
}

/**
 * Copy-on-write home page: the landing decomposed. Now-playing at
 * full width on main; coming-next and volume stacked on the rail.
 * The built-in hero (and its hard-coded rail) stay the default until
 * this page exists; removing the page restores them. The fake
 * spectrum and fake cast do not carry over.
 */
export function synthesizeHomePage(
  doc: LayoutDocument | null,
): AddPageResult {
  const base = doc ?? baseDocument();
  if (base.pages.some((page) => page.id === "home")) {
    return { doc: base, pageId: "home" };
  }
  return {
    doc: { ...base, pages: [...base.pages, DEFAULT_HOME_PAGE] },
    pageId: "home",
  };
}

/** Dock a page's rail to an edge. Default (right) stores nothing. */
export function setPageRailPosition(
  doc: LayoutDocument,
  pageId: string,
  position: RailPosition,
): LayoutDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) => {
      if (page.id !== pageId) return page;
      if (position === "right") {
        const { railPosition: _drop, ...rest } = page;
        return rest;
      }
      return { ...page, railPosition: position };
    }),
  };
}

/** Set a page's rail surface opacity (0..1). 0 = transparent, the
 *  default - stores nothing. Clamped; style only, never geometry. */
export function setPageRailOpacity(
  doc: LayoutDocument,
  pageId: string,
  opacity: number,
): LayoutDocument {
  const v = Math.min(1, Math.max(0, opacity));
  return {
    ...doc,
    pages: doc.pages.map((page) => {
      if (page.id !== pageId) return page;
      if (v === 0) {
        const { railOpacity: _drop, ...rest } = page;
        return rest;
      }
      return { ...page, railOpacity: v };
    }),
  };
}

/** Rename a page. Empty input keeps the previous name. */
export function renamePage(
  doc: LayoutDocument,
  pageId: string,
  name: string,
): LayoutDocument {
  const trimmed = name.trim();
  if (trimmed.length === 0) return doc;
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.id === pageId ? { ...page, name: trimmed } : page,
    ),
  };
}

/** Every widget kind currently placed anywhere in the document. */
export function placedKinds(doc: LayoutDocument | null): ReadonlySet<string> {
  const out = new Set<string>();
  for (const page of doc?.pages ?? []) {
    for (const slots of Object.values(page.regions)) {
      for (const slot of slots ?? []) out.add(slot.widgetKindId);
    }
  }
  return out;
}

/** Append a catalog widget to the page's main region at ideal size. */
export function addWidget(
  doc: LayoutDocument,
  pageId: string,
  kind: AppWidgetKind,
): LayoutDocument {
  const slot: LayoutSlot = {
    widgetKindId: kind.id,
    size: kind.idealSize,
    foldPriority: DEFAULT_FOLD_PRIORITY,
  };
  return mapMain(doc, pageId, (slots) => [...slots, slot]);
}

export function removeWidget(
  doc: LayoutDocument,
  pageId: string,
  index: number,
): LayoutDocument {
  return mapMain(doc, pageId, (slots) =>
    slots.filter((_, i) => i !== index),
  );
}

export function moveWidget(
  doc: LayoutDocument,
  pageId: string,
  index: number,
  delta: -1 | 1,
): LayoutDocument {
  return mapMain(doc, pageId, (slots) => {
    const j = index + delta;
    if (index < 0 || index >= slots.length || j < 0 || j >= slots.length) {
      return slots;
    }
    const next = [...slots];
    const [moved] = next.splice(index, 1);
    next.splice(j, 0, moved);
    return next;
  });
}

/** Set a slot's size. Sizes outside the kind envelope are refused. */
export function setWidgetSize(
  doc: LayoutDocument,
  pageId: string,
  index: number,
  size: UiSize,
  kind: AppWidgetKind | undefined,
): LayoutDocument {
  if (kind !== undefined && !sizeInEnvelope(size, kind)) return doc;
  return mapMain(doc, pageId, (slots) =>
    slots.map((slot, i) => (i === index ? { ...slot, size } : slot)),
  );
}

const SIZE_ORDER: readonly UiSize[] = [
  "atom",
  "quarter",
  "third",
  "half",
  "two-thirds",
  "full",
];

export function sizeInEnvelope(size: UiSize, kind: AppWidgetKind): boolean {
  const i = SIZE_ORDER.indexOf(size);
  return (
    i >= SIZE_ORDER.indexOf(kind.minSize) &&
    i <= SIZE_ORDER.indexOf(kind.maxSize)
  );
}

/* ------------------------------------------------------------------ */
/* Region-aware operations (build canvas)                              */
/* ------------------------------------------------------------------ */

/**
 * Sizes legal for a kind inside a region: the widget envelope
 * intersected with the region contract - the same rule the resolver
 * enforces, applied at authoring time so the canvas can clamp drops
 * and the inspector can disable illegal cells.
 */
export function legalSizesFor(
  kind: AppWidgetKind,
  region: PageRegionId,
): readonly UiSize[] {
  return SIZE_ORDER.filter(
    (size) =>
      sizeInEnvelope(size, kind) &&
      PAGE_REGIONS[region].acceptsSizes.includes(size),
  );
}

/** Clamp a wanted size into the legal set; null when nothing fits. */
export function clampSizeFor(
  kind: AppWidgetKind,
  region: PageRegionId,
  want: UiSize,
): UiSize | null {
  const legal = legalSizesFor(kind, region);
  if (legal.length === 0) return null;
  if (legal.includes(want)) return want;
  if (legal.includes(kind.idealSize)) return kind.idealSize;
  const wantIdx = SIZE_ORDER.indexOf(want);
  let best = legal[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const size of legal) {
    const d = Math.abs(SIZE_ORDER.indexOf(size) - wantIdx);
    if (d < bestDist) {
      bestDist = d;
      best = size;
    }
  }
  return best;
}

export interface SlotOpResult {
  readonly doc: LayoutDocument;
  /** Non-null when the operation was refused; doc is then unchanged. */
  readonly refusal: string | null;
  /** Where the affected slot ended up (placement ops). */
  readonly address?: SlotAddress;
}

/**
 * Insert a catalog widget at a position inside any region. The size
 * lands at the ideal clamped into the region's legal set; a region
 * with no legal size refuses with the contract reason.
 */
export function insertWidgetAt(
  doc: LayoutDocument,
  pageId: string,
  kind: AppWidgetKind,
  to: { readonly region: PageRegionId; readonly index: number | null },
): SlotOpResult {
  const size = clampSizeFor(kind, to.region, kind.idealSize);
  if (size === null) {
    return {
      doc,
      refusal: `region '${to.region}' accepts [${PAGE_REGIONS[to.region].acceptsSizes.join(", ")}] - no size in ${kind.label}'s envelope ${kind.minSize}..${kind.maxSize} fits`,
    };
  }
  const slot: LayoutSlot = {
    widgetKindId: kind.id,
    size,
    foldPriority: DEFAULT_FOLD_PRIORITY,
  };
  let placedIndex = 0;
  const next = mapRegion(doc, pageId, to.region, (slots) => {
    const i = to.index === null ? slots.length : clampIndex(to.index, slots.length);
    placedIndex = i;
    const out = [...slots];
    out.splice(i, 0, slot);
    return out;
  });
  return {
    doc: next,
    refusal: null,
    address: { region: to.region, index: placedIndex },
  };
}

/**
 * Move a placed slot to a new position, possibly across regions. The
 * size clamps into the target region's legal set; an impossible
 * target refuses and leaves the document untouched.
 */
export function moveSlot(
  doc: LayoutDocument,
  pageId: string,
  from: SlotAddress,
  to: { readonly region: PageRegionId; readonly index: number | null },
  kind: AppWidgetKind | undefined,
): SlotOpResult {
  const page = doc.pages.find((p) => p.id === pageId);
  const slot = page?.regions[from.region]?.[from.index];
  if (page === undefined || slot === undefined) {
    return { doc, refusal: null };
  }
  let size = slot.size;
  if (from.region !== to.region && kind !== undefined) {
    const clamped = clampSizeFor(kind, to.region, slot.size);
    if (clamped === null) {
      return {
        doc,
        refusal: `cannot move ${kind.label} to '${to.region}' - no size in envelope ${kind.minSize}..${kind.maxSize} satisfies [${PAGE_REGIONS[to.region].acceptsSizes.join(", ")}]`,
      };
    }
    size = clamped;
  }
  // Remove from source, then insert into target (index adjusted when
  // moving forward within the same region).
  const moved: LayoutSlot = { ...slot, size };
  let removed = mapRegion(doc, pageId, from.region, (slots) =>
    slots.filter((_, i) => i !== from.index),
  );
  let targetIndex =
    to.index === null
      ? (removed.pages.find((p) => p.id === pageId)?.regions[to.region] ?? [])
          .length
      : to.index;
  if (from.region === to.region && to.index !== null && to.index > from.index) {
    targetIndex = to.index - 1;
  }
  let placedIndex = 0;
  removed = mapRegion(removed, pageId, to.region, (slots) => {
    const i = clampIndex(targetIndex, slots.length);
    placedIndex = i;
    const out = [...slots];
    out.splice(i, 0, moved);
    return out;
  });
  return {
    doc: removed,
    refusal: null,
    address: { region: to.region, index: placedIndex },
  };
}

export function removeSlot(
  doc: LayoutDocument,
  pageId: string,
  at: SlotAddress,
): LayoutDocument {
  return mapRegion(doc, pageId, at.region, (slots) =>
    slots.filter((_, i) => i !== at.index),
  );
}

export function setSlotSize(
  doc: LayoutDocument,
  pageId: string,
  at: SlotAddress,
  size: UiSize,
  kind: AppWidgetKind | undefined,
): LayoutDocument {
  if (kind !== undefined && !legalSizesFor(kind, at.region).includes(size)) {
    return doc;
  }
  return mapRegion(doc, pageId, at.region, (slots) =>
    slots.map((slot, i) => (i === at.index ? { ...slot, size } : slot)),
  );
}

/** Row placement pin - meaningful on the main grid only. */
export function setSlotAlign(
  doc: LayoutDocument,
  pageId: string,
  at: SlotAddress,
  align: SlotAlign,
): LayoutDocument {
  return mapRegion(doc, pageId, at.region, (slots) =>
    slots.map((slot, i) => {
      if (i !== at.index) return slot;
      if (align === "auto") {
        const { align: _drop, ...rest } = slot;
        return rest;
      }
      return { ...slot, align };
    }),
  );
}

export function setSlotPriority(
  doc: LayoutDocument,
  pageId: string,
  at: SlotAddress,
  foldPriority: FoldPriority,
): LayoutDocument {
  return mapRegion(doc, pageId, at.region, (slots) =>
    slots.map((slot, i) => (i === at.index ? { ...slot, foldPriority } : slot)),
  );
}

export function slotAt(
  doc: LayoutDocument | null,
  pageId: string,
  at: SlotAddress,
): LayoutSlot | undefined {
  return doc?.pages.find((p) => p.id === pageId)?.regions[at.region]?.[
    at.index
  ];
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

function mapRegion(
  doc: LayoutDocument,
  pageId: string,
  region: PageRegionId,
  fn: (slots: readonly LayoutSlot[]) => readonly LayoutSlot[],
): LayoutDocument {
  const page = doc.pages.find((p) => p.id === pageId);
  if (page === undefined) return doc;
  const slots = page.regions[region] ?? [];
  const next = fn(slots);
  if (next === slots) return doc;
  return {
    ...doc,
    pages: doc.pages.map((p) =>
      p.id === pageId
        ? { ...p, regions: { ...p.regions, [region]: next } }
        : p,
    ),
  };
}

function mapMain(
  doc: LayoutDocument,
  pageId: string,
  fn: (slots: readonly LayoutSlot[]) => readonly LayoutSlot[],
): LayoutDocument {
  const page = doc.pages.find((p) => p.id === pageId);
  if (page === undefined) return doc;
  const slots = page.regions.main ?? [];
  const next = fn(slots);
  if (next === slots) return doc; // no-op stays reference-equal
  return {
    ...doc,
    pages: doc.pages.map((p) =>
      p.id === pageId
        ? { ...p, regions: { ...p.regions, main: next } }
        : p,
    ),
  };
}
