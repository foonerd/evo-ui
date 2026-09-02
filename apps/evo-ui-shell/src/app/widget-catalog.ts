// App-side widget catalog: the placeable blocks for document pages.
//
// The operator UI (App.tsx) does not boot the schema-first stocking
// runtime, so document pages resolve against this catalog instead: a
// synthetic availability snapshot funding exactly one instance of
// each catalog kind. The SAME resolver (runtime/layout-document.ts
// resolveLayout) runs against it, so envelope clamping, region
// contracts, and instance budgets behave identically to the stocking
// path — when the framework's admitted stockings replace this
// catalog, the documents and the resolution semantics carry over
// unchanged.
//
// Every catalog kind maps to an existing, fully functional App
// surface (wired in App.tsx). No placeholders: a kind ships here only
// when its surface works end to end.

import type {
  UiSize,
  UiSnapshot,
  WidgetKindEnvelope,
} from "../runtime/stockings.ts";
import type { LayoutDocument, LayoutPage } from "../runtime/layout-document.ts";

export const CATALOG_PLUGIN_ID = "evo-ui-shell";
export const CATALOG_SHELF_ID = "app.catalog";

export interface AppWidgetKind {
  readonly id: string;
  readonly label: string;
  readonly minSize: UiSize;
  readonly idealSize: UiSize;
  readonly maxSize: UiSize;
}

export const APP_WIDGET_KINDS: readonly AppWidgetKind[] = [
  {
    id: "evo.app.nowplaying",
    label: "Now playing",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.queue",
    label: "Queue",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.browse",
    label: "Browse",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.favourites",
    label: "Favourites",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.playlists",
    label: "Playlists",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  {
    // Multi-recording works (classical / audiophile record keeping).
    // The default VIEW is auto-gated by the library counters; the
    // WIDGET is always placeable - explicit operator placement beats
    // auto-gating, and WorksSurface carries its own empty states.
    id: "evo.app.works",
    label: "Works",
    minSize: "third",
    idealSize: "half",
    maxSize: "full",
  },
  // Landing decomposition: the pieces of the old hard-coded home
  // rail that carry real function become placeable widgets. The
  // fake spectrum decoration and fake cast card are deliberately
  // NOT widgets - they die with the hard-coded rail.
  {
    id: "evo.app.comingnext",
    label: "Coming next",
    minSize: "atom",
    idealSize: "quarter",
    maxSize: "half",
  },
  {
    id: "evo.app.volume",
    label: "Volume",
    minSize: "atom",
    idealSize: "atom",
    maxSize: "quarter",
  },
  {
    id: "evo.app.meta.combined",
    label: "Track info (combined)",
    minSize: "atom",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.meta.bio",
    label: "Artist bio",
    minSize: "atom",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.meta.albumnotes",
    label: "Album notes",
    minSize: "atom",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.meta.lyrics",
    label: "Lyrics",
    minSize: "atom",
    idealSize: "half",
    maxSize: "full",
  },
  {
    id: "evo.app.meta.provenance",
    label: "Provenance",
    minSize: "atom",
    idealSize: "quarter",
    maxSize: "half",
  },
  {
    id: "evo.app.meta.smart",
    label: "Smart metadata",
    minSize: "atom",
    idealSize: "half",
    maxSize: "full",
  },
];

/**
 * Synthetic availability snapshot over the catalog. One funded
 * instance per kind — a document placing the same surface twice
 * resolves the second slot `unavailable`, mirroring the stocking
 * budget semantics.
 */
export function catalogSnapshot(): UiSnapshot {
  const widgetKinds: Record<string, WidgetKindEnvelope> = {};
  for (const kind of APP_WIDGET_KINDS) {
    widgetKinds[kind.id] = {
      id: kind.id,
      minSize: kind.minSize,
      idealSize: kind.idealSize,
      maxSize: kind.maxSize,
      aspectRatio: "any",
      responsive: {},
      mode: "inline",
      schemaVersion: 1,
    };
  }
  return {
    shelves: {},
    widgetKinds,
    stockings: {
      [CATALOG_SHELF_ID]: APP_WIDGET_KINDS.map((kind) => ({
        plugin: CATALOG_PLUGIN_ID,
        shelfId: CATALOG_SHELF_ID,
        widgetKindId: kind.id,
        size: kind.idealSize,
        schemaVersion: 1,
      })),
    },
  };
}

export function catalogKind(id: string): AppWidgetKind | undefined {
  return APP_WIDGET_KINDS.find((kind) => kind.id === id);
}

/**
 * Contract kinds - the Tier 0 rule made real: presence locked on
 * home, and NEVER shed by the fold model regardless of any stored
 * priority (the centre stage folds last or never, per
 * UI_ARCHITECTURE_ONE_PAGE.md and RESPONSIVE_FOLD_MODEL.md's region
 * order). Grows to the full Tier 0 set (transport, title, artist,
 * volume) when the now-playing decomposition lands.
 */
export const APP_CONTRACT_KINDS: ReadonlySet<string> = new Set([
  "evo.app.nowplaying",
]);

/**
 * The shipped home page - the landing expressed as blocks, per the
 * founding principle that defaults are pre-made arrangements of the
 * same widgets. The device renders THIS when no home page is stored;
 * editing it in the designer stores a copy. The old hard-coded hero
 * (fake spectrum, fake cast, placeholder bio) is pivot-only legacy.
 */
export const DEFAULT_HOME_PAGE: LayoutPage = {
  id: "home",
  name: "Now playing",
  regions: {
    main: [
      { widgetKindId: "evo.app.nowplaying", size: "full", foldPriority: 5 },
    ],
    rail: [
      { widgetKindId: "evo.app.comingnext", size: "quarter", foldPriority: 3 },
      { widgetKindId: "evo.app.volume", size: "atom", foldPriority: 4 },
    ],
  },
};

/**
 * Built-in views that are really one catalog widget at full width -
 * the shipped default expressed as data. The designer offers these
 * as default builder pages: copy-on-write, so an untouched view
 * stores nothing and renders the hard-wired surface exactly as
 * before; a synthesized page with this shape renders identically;
 * removing the page restores the built-in view.
 */
export interface ViewPageDefault {
  /** NavView id the page overrides. */
  readonly viewId: string;
  readonly name: string;
  readonly widgetKindId: string;
}

export const VIEW_PAGE_DEFAULTS: readonly ViewPageDefault[] = [
  { viewId: "library", name: "Queue", widgetKindId: "evo.app.queue" },
  { viewId: "explore", name: "Browse", widgetKindId: "evo.app.browse" },
  { viewId: "favourites", name: "Favourites", widgetKindId: "evo.app.favourites" },
  { viewId: "playlists", name: "Playlists", widgetKindId: "evo.app.playlists" },
  { viewId: "works", name: "Works", widgetKindId: "evo.app.works" },
];

/**
 * The remote screen's default: the full-reference view. DERIVED from
 * the catalog at call time and never stored, so installing a widget
 * or page extends the reference automatically and it cannot go
 * stale. It is the complete capability surface - the default home
 * arrangement plus every view expressed as a page - the answer to
 * "what can this UI do". Reset-remote deletes the stored remote
 * layout and lands here.
 */
export function synthesizeRemoteReference(): LayoutDocument {
  const pages: LayoutPage[] = [
    DEFAULT_HOME_PAGE,
    ...VIEW_PAGE_DEFAULTS.map(
      (v): LayoutPage => ({
        id: v.viewId,
        name: v.name,
        regions: {
          main: [{ widgetKindId: v.widgetKindId, size: "full", foldPriority: 3 }],
        },
      })
    ),
  ];
  // Auto-extend so the reference is DERIVED, not hard-coded, and
  // "cannot go stale": every catalog kind not already placed by the
  // home + view pages (e.g. the whole evo.app.meta.* family) gets its
  // own reference page. Adding a widget kind to the catalog thus
  // extends the capability surface automatically - no second edit
  // site to forget, which is exactly how the metadata widgets fell
  // off the reference before.
  const placed = new Set<string>();
  for (const page of pages) {
    for (const slots of Object.values(page.regions)) {
      for (const slot of slots ?? []) placed.add(slot.widgetKindId);
    }
  }
  for (const kind of APP_WIDGET_KINDS) {
    if (placed.has(kind.id)) continue;
    pages.push({
      id: `ref:${kind.id}`,
      name: kind.label,
      regions: {
        // Its idealSize, not a hard "full": some kinds (e.g.
        // provenance) cap below full, and overshooting the envelope
        // would refuse at resolve time.
        main: [{ widgetKindId: kind.id, size: kind.idealSize, foldPriority: 3 }],
      },
    });
    placed.add(kind.id);
  }
  // Uncurated: the default menu renders in full, with each view
  // transparently backed by its reference page (chunk 4d override
  // semantics). Nothing hidden - a reference view hides nothing.
  return { schemaVersion: 1, pages, nav: { position: "left", entries: [] } };
}
