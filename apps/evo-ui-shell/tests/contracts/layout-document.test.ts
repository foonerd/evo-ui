import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FOLD_PRIORITY,
  LANDING_PAGE_ID,
  LAYOUT_SCHEMA_VERSION,
  decodeLayoutDocument,
  mergeAvailability,
  resolveLayout,
  shedAtTier,
  synthesizeLayoutDocument,
  validateLayoutDocument,
  type LayoutDocument,
} from "../../src/runtime/layout-document.ts";

import { parseDisplayProfileSettings } from "../../src/runtime/ui-profile.ts";

import type {
  AdmittedStocking,
  ShelfContract,
  UiSnapshot,
  WidgetKindEnvelope,
} from "../../src/runtime/stockings.ts";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function shelf(id: string, overrides?: Partial<ShelfContract>): ShelfContract {
  return {
    id,
    cardinality: "any-to-many",
    acceptsWidgets: { kind: "any" },
    acceptsSizes: [],
    layout: "grid",
    orderBy: "manifest_declaration",
    schemaVersion: 1,
    ...overrides,
  };
}

function envelope(
  id: string,
  overrides?: Partial<WidgetKindEnvelope>,
): WidgetKindEnvelope {
  return {
    id,
    minSize: "atom",
    idealSize: "third",
    maxSize: "full",
    aspectRatio: "any",
    responsive: {},
    mode: "inline",
    schemaVersion: 1,
    ...overrides,
  };
}

function stocking(
  plugin: string,
  shelfId: string,
  widgetKindId: string,
  size: string,
): AdmittedStocking {
  return { plugin, shelfId, widgetKindId, size, schemaVersion: 1 };
}

function snapshot(): UiSnapshot {
  return {
    shelves: {
      "system.tiles": shelf("system.tiles"),
      "audio.surfaces": shelf("audio.surfaces", { orderBy: "alphabetical" }),
    },
    widgetKinds: {
      "evo.audio.queue.list": envelope("evo.audio.queue.list", {
        minSize: "quarter",
        idealSize: "half",
        maxSize: "full",
      }),
      "evo.audio.metering.peak": envelope("evo.audio.metering.peak", {
        minSize: "atom",
        idealSize: "quarter",
        maxSize: "half",
        responsive: { compact: "atom" },
      }),
      "evo.plugins.entry": envelope("evo.plugins.entry", {
        minSize: "atom",
        idealSize: "atom",
        maxSize: "quarter",
      }),
      "evo.player.transport": envelope("evo.player.transport", {
        minSize: "quarter",
        idealSize: "third",
        maxSize: "half",
      }),
    },
    stockings: {
      "system.tiles": [
        stocking("evo-core", "system.tiles", "evo.plugins.entry", "atom"),
      ],
      "audio.surfaces": [
        stocking("evo-device-audio", "audio.surfaces", "evo.audio.queue.list", "half"),
        stocking("evo-device-audio", "audio.surfaces", "evo.audio.metering.peak", "quarter"),
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* synthesis                                                           */
/* ------------------------------------------------------------------ */

test("synthesizeLayoutDocument expresses manifest composition as data", () => {
  const doc = synthesizeLayoutDocument(snapshot());
  assert.equal(doc.schemaVersion, LAYOUT_SCHEMA_VERSION);
  assert.equal(doc.pages.length, 1);
  const landing = doc.pages[0];
  assert.equal(landing.id, LANDING_PAGE_ID);
  const main = landing.regions.main ?? [];
  // Shelf ids sorted: audio.surfaces before system.tiles; the audio
  // shelf orders alphabetically (metering before queue).
  assert.deepEqual(
    main.map((s) => s.widgetKindId),
    ["evo.audio.metering.peak", "evo.audio.queue.list", "evo.plugins.entry"],
  );
  assert.deepEqual(
    main.map((s) => s.size),
    ["quarter", "half", "atom"],
  );
  assert.ok(main.every((s) => s.foldPriority === DEFAULT_FOLD_PRIORITY));
  assert.ok(main.every((s) => s.sourceShelf !== undefined));
  assert.deepEqual(doc.nav.entries, [
    { type: "page", page: LANDING_PAGE_ID },
  ]);
});

test("synthesizeLayoutDocument keeps stockings on undeclared shelves", () => {
  const snap = snapshot();
  const withOrphan: UiSnapshot = {
    ...snap,
    stockings: {
      ...snap.stockings,
      "vendor.orphan": [
        stocking("vendor-x", "vendor.orphan", "evo.plugins.entry", "atom"),
      ],
    },
  };
  const doc = synthesizeLayoutDocument(withOrphan);
  const main = doc.pages[0].regions.main ?? [];
  assert.equal(main.length, 4);
});

test("synthesizeLayoutDocument marks contract kinds critical", () => {
  const snap = snapshot();
  const withTier0: UiSnapshot = {
    ...snap,
    stockings: {
      ...snap.stockings,
      "landing.deck": [
        stocking("evo-core", "landing.deck", "evo.player.transport", "third"),
      ],
    },
  };
  const doc = synthesizeLayoutDocument(withTier0, {
    contractKinds: new Set(["evo.player.transport"]),
  });
  const transport = (doc.pages[0].regions.main ?? []).find(
    (s) => s.widgetKindId === "evo.player.transport",
  );
  assert.equal(transport?.foldPriority, 5);
});

/* ------------------------------------------------------------------ */
/* decode                                                              */
/* ------------------------------------------------------------------ */

test("decodeLayoutDocument round-trips a synthesized document", () => {
  const doc = synthesizeLayoutDocument(snapshot());
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(decoded, doc);
});

test("decodeLayoutDocument refuses newer schema and non-documents", () => {
  assert.equal(decodeLayoutDocument(null), null);
  assert.equal(decodeLayoutDocument("layout"), null);
  assert.equal(decodeLayoutDocument({ pages: "nope" }), null);
  assert.equal(
    decodeLayoutDocument({
      schemaVersion: LAYOUT_SCHEMA_VERSION + 1,
      pages: [{ id: "landing", regions: {} }],
    }),
    null,
  );
});

test("decodeLayoutDocument drops malformed slots and clamps priority", () => {
  const decoded = decodeLayoutDocument({
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          main: [
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 99 },
            { widgetKindId: "evo.bad.size", size: "enormous" },
            { size: "half" },
            "not-a-slot",
          ],
        },
      },
    ],
    nav: {
      position: "bottom",
      entries: [
        { type: "page", page: "landing", label: "Home" },
        { type: "widget", page: "landing", widgetKindId: "evo.audio.queue.list" },
        { type: "widget", page: "landing" },
      ],
    },
  });
  assert.notEqual(decoded, null);
  const main = decoded!.pages[0].regions.main ?? [];
  assert.equal(main.length, 1);
  assert.equal(main[0].foldPriority, 5);
  assert.equal(decoded!.nav.position, "bottom");
  assert.equal(decoded!.nav.entries.length, 2);
});

test("decodeLayoutDocument validates style tokens", () => {
  const decoded = decodeLayoutDocument({
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        regions: {
          main: [
            {
              widgetKindId: "evo.audio.queue.list",
              size: "half",
              foldPriority: 4,
              align: "center",
              style: { type: "xl", density: "loose", accent: "#35c4b5" },
            },
          ],
        },
      },
    ],
  });
  const slot = decoded!.pages[0].regions.main![0];
  assert.equal(slot.align, "center");
  assert.equal(slot.style?.type, "xl");
  assert.equal(slot.style?.accent, "#35c4b5");
  // invalid density dropped, valid siblings kept
  assert.equal(slot.style?.density, undefined);
});

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

test("validateLayoutDocument passes the synthesized default", () => {
  const snap = snapshot();
  const doc = synthesizeLayoutDocument(snap);
  const result = validateLayoutDocument(doc, snap);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("validateLayoutDocument flags envelope, region, and contract violations", () => {
  const snap = snapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: LANDING_PAGE_ID,
        name: "Landing",
        regions: {
          deck: [
            // half is outside the deck's accepts (atom..third) and
            // fine for the queue envelope — region issue only.
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 3 },
          ],
        },
      },
      {
        id: "settings",
        name: "Settings",
        regions: {
          main: [
            // transport off-landing violates the contract rule; full
            // is also outside its envelope (quarter..half).
            { widgetKindId: "evo.player.transport", size: "full", foldPriority: 5 },
            { widgetKindId: "evo.gone.kind", size: "atom", foldPriority: 1 },
          ],
        },
      },
    ],
    nav: {
      position: "left",
      entries: [
        { type: "page", page: "nowhere" },
        { type: "widget", page: "settings", widgetKindId: "evo.not.placed" },
      ],
    },
  };
  const result = validateLayoutDocument(
    doc,
    snap,
    new Set(["evo.player.transport", "evo.nowplaying.meta"]),
  );
  assert.equal(result.ok, false);
  const kinds = result.issues.map((i) => i.kind).sort();
  assert.deepEqual(kinds, [
    "contract-missing",        // evo.nowplaying.meta absent entirely
    "contract-off-landing",    // transport on settings
    "nav-dead-page",           // page 'nowhere'
    "nav-dead-widget",         // widget not placed on settings
    "size-outside-envelope",   // transport at full
    "size-outside-region",     // queue half on the deck
    "unknown-widget-kind",     // evo.gone.kind
  ]);
});

/* ------------------------------------------------------------------ */
/* resolution + shedding                                               */
/* ------------------------------------------------------------------ */

test("resolveLayout applies envelope semantics and explicit statuses", () => {
  const snap = snapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: LANDING_PAGE_ID,
        name: "Landing",
        regions: {
          main: [
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 4 },
            { widgetKindId: "evo.audio.metering.peak", size: "quarter", foldPriority: 2 },
            { widgetKindId: "evo.gone.kind", size: "atom", foldPriority: 1 },
          ],
          rail: [
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 3 },
          ],
        },
      },
    ],
    nav: { position: "left", entries: [] },
  };

  const wide = resolveLayout(doc, snap, "wide");
  const main = wide.pages[0].regions.main!;
  assert.equal(main[0].status.kind, "admitted");
  assert.equal(main[0].effectiveSize, "half");
  assert.equal(main[1].status.kind, "admitted");
  assert.equal(main[2].status.kind, "unavailable");
  // The rail accepts every size now; this second queue slot fails on
  // the instance budget instead (main consumed the only stocking).
  const rail = wide.pages[0].regions.rail!;
  assert.equal(rail[0].status.kind, "unavailable");

  // compact: metering's responsive override kicks in.
  const compact = resolveLayout(doc, snap, "compact");
  assert.equal(compact.pages[0].regions.main![1].effectiveSize, "atom");
});

test("shedAtTier sheds by priority and never sheds contract blocks", () => {
  const snap = snapshot();
  const withTransport: UiSnapshot = {
    ...snap,
    stockings: {
      ...snap.stockings,
      "landing.deck": [
        stocking("evo-core", "landing.deck", "evo.player.transport", "third"),
      ],
    },
  };
  const contractKinds = new Set(["evo.player.transport"]);
  const doc = synthesizeLayoutDocument(withTransport, { contractKinds });
  const resolved = resolveLayout(doc, withTransport, "wide");
  const main = resolved.pages[0].regions.main!;

  const atStrip = shedAtTier(main, 6, contractKinds);
  assert.deepEqual(
    atStrip.visible.map((r) => r.slot.widgetKindId),
    ["evo.player.transport"],
  );
  assert.equal(atStrip.shed.length, main.length - 1);

  const atFull = shedAtTier(main, 1, contractKinds);
  assert.equal(atFull.shed.length, 0);
});

/* ------------------------------------------------------------------ */
/* availability merge                                                  */
/* ------------------------------------------------------------------ */

test("mergeAvailability appends newly admitted stockings to landing main", () => {
  const snap = snapshot();
  const doc = synthesizeLayoutDocument(snap);
  const grown: UiSnapshot = {
    ...snap,
    stockings: {
      ...snap.stockings,
      "vendor.shelf": [
        stocking("vendor-nas", "vendor.shelf", "vendor.nas.browser", "half"),
      ],
    },
  };
  const merged = mergeAvailability(doc, grown);
  assert.deepEqual(merged.appended, ["vendor.nas.browser"]);
  const main = merged.doc.pages[0].regions.main!;
  assert.equal(main[main.length - 1].widgetKindId, "vendor.nas.browser");
  assert.equal(main[main.length - 1].foldPriority, DEFAULT_FOLD_PRIORITY);
});

test("mergeAvailability keeps slots for withdrawn availability and is idempotent", () => {
  const snap = snapshot();
  const doc = synthesizeLayoutDocument(snap);
  const shrunk: UiSnapshot = {
    ...snap,
    stockings: {
      "system.tiles": snap.stockings["system.tiles"],
      "audio.surfaces": [],
    },
  };
  const merged = mergeAvailability(doc, shrunk);
  assert.deepEqual(merged.appended, []);
  // withdrawn slots stay in the document...
  assert.equal(merged.doc.pages[0].regions.main!.length, 3);
  // ...and resolve unavailable rather than vanishing.
  const resolved = resolveLayout(merged.doc, shrunk, "wide");
  const statuses = resolved.pages[0].regions.main!.map((r) => r.status.kind);
  assert.deepEqual(statuses.sort(), ["admitted", "unavailable", "unavailable"]);

  // merging against the unchanged snapshot appends nothing.
  const again = mergeAvailability(doc, snap);
  assert.deepEqual(again.appended, []);
  assert.equal(again.doc, doc);
});

test("mergeAvailability is count-based per (plugin, kind)", () => {
  const snap = snapshot();
  const doc = synthesizeLayoutDocument(snap);
  const doubled: UiSnapshot = {
    ...snap,
    stockings: {
      ...snap.stockings,
      "audio.surfaces": [
        ...snap.stockings["audio.surfaces"],
        stocking("evo-device-audio", "audio.surfaces", "evo.audio.queue.list", "half"),
      ],
    },
  };
  const merged = mergeAvailability(doc, doubled);
  assert.deepEqual(merged.appended, ["evo.audio.queue.list"]);
});

/* ------------------------------------------------------------------ */
/* ui.profile integration                                              */
/* ------------------------------------------------------------------ */

test("ui.profile carries a layout document per target and custom", () => {
  const doc = synthesizeLayoutDocument(snapshot());
  const parsed = parseDisplayProfileSettings({
    byTarget: {
      "1280x720@7": {
        displayFactor: 1.1,
        layout: JSON.parse(JSON.stringify(doc)),
      },
    },
    custom: { widthPx: 800, heightPx: 480, layout: { pages: "garbage" } },
  });
  assert.deepEqual(parsed?.byTarget?.["1280x720@7"]?.layout, doc);
  // malformed layout on custom is dropped, siblings survive.
  assert.equal(parsed?.custom?.layout, undefined);
  assert.equal(parsed?.custom?.widthPx, 800);
});

test("budget is per page: the same widget lives on many pages, one visible at a time", () => {
  const snap = snapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          main: [
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 4 },
          ],
        },
      },
      {
        id: "page-1",
        name: "Extras",
        regions: {
          main: [
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 4 },
            // second instance on the SAME page exceeds the funded count
            { widgetKindId: "evo.audio.queue.list", size: "half", foldPriority: 4 },
          ],
        },
      },
    ],
    nav: { position: "left", entries: [] },
  };
  const resolved = resolveLayout(doc, snap, "wide");
  assert.equal(resolved.pages[0].regions.main![0].status.kind, "admitted");
  assert.equal(resolved.pages[1].regions.main![0].status.kind, "admitted");
  assert.equal(resolved.pages[1].regions.main![1].status.kind, "unavailable");
});
