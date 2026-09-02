import test from "node:test";
import assert from "node:assert/strict";

import {
  addPage,
  addWidget,
  baseDocument,
  editablePages,
  moveWidget,
  placedKinds,
  removePage,
  removeWidget,
  renamePage,
  setWidgetSize,
} from "../../src/dev/designer-pages.ts";

import { curateNavItems, type CuratableNavItem } from "../../src/app/nav-curation.ts";
import { APP_WIDGET_KINDS, catalogKind, catalogSnapshot } from "../../src/app/widget-catalog.ts";
import { resolveLayout } from "../../src/runtime/layout-document.ts";

const DEFAULTS: readonly CuratableNavItem[] = [
  { id: "home", label: "Home" },
  { id: "library", label: "Queue" },
  { id: "system", label: "Settings" },
];

const QUEUE = catalogKind("evo.app.queue")!;
const BROWSE = catalogKind("evo.app.browse")!;

test("addPage on empty profile backfills the full default menu", () => {
  const { doc, pageId } = addPage(null, "Extras", DEFAULTS);
  assert.equal(pageId, "page-1");
  assert.equal(editablePages(doc).length, 1);
  const curated = curateNavItems(DEFAULTS, doc);
  assert.equal(curated.curated, true);
  assert.deepEqual(
    curated.items.map((i) => (i.kind === "view" ? i.id : i.pageId)),
    ["home", "library", "system", "page-1"],
  );
});

test("addPage on a curated document appends only the new entry", () => {
  const first = addPage(null, "One", DEFAULTS).doc;
  const { doc } = addPage(first, "Two", DEFAULTS);
  const pageEntries = doc.nav.entries.filter((e) => e.type === "page");
  assert.equal(pageEntries.length, DEFAULTS.length + 2);
  assert.equal(doc.pages.length, 3); // landing + two
  assert.equal(doc.pages[2].id, "page-2");
});

test("removePage drops the page and its menu entries; landing refuses", () => {
  const { doc } = addPage(null, "Extras", DEFAULTS);
  const removed = removePage(doc, "page-1");
  assert.equal(editablePages(removed).length, 0);
  assert.equal(
    removed.nav.entries.some((e) => e.page === "page-1"),
    false,
  );
  assert.equal(removePage(doc, "landing"), doc);
});

test("renamePage renames; empty input keeps the old name", () => {
  const { doc } = addPage(null, "Extras", DEFAULTS);
  const renamed = renamePage(doc, "page-1", "  My stuff  ");
  assert.equal(renamed.pages[1].name, "My stuff");
  assert.equal(renamePage(renamed, "page-1", "   ").pages[1].name, "My stuff");
});

test("widget lifecycle: add at ideal, resize inside envelope, reorder, remove", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  doc = addWidget(doc, "page-1", BROWSE);
  let main = doc.pages[1].regions.main!;
  assert.deepEqual(
    main.map((s) => [s.widgetKindId, s.size]),
    [
      ["evo.app.queue", QUEUE.idealSize],
      ["evo.app.browse", BROWSE.idealSize],
    ],
  );

  // resize: legal applies, out-of-envelope refuses (queue min third)
  doc = setWidgetSize(doc, "page-1", 0, "full", QUEUE);
  assert.equal(doc.pages[1].regions.main![0].size, "full");
  doc = setWidgetSize(doc, "page-1", 0, "atom", QUEUE);
  assert.equal(doc.pages[1].regions.main![0].size, "full");

  doc = moveWidget(doc, "page-1", 1, -1);
  assert.equal(doc.pages[1].regions.main![0].widgetKindId, "evo.app.browse");
  assert.equal(moveWidget(doc, "page-1", 0, -1), doc);

  doc = removeWidget(doc, "page-1", 0);
  main = doc.pages[1].regions.main!;
  assert.equal(main.length, 1);
  assert.equal(main[0].widgetKindId, "evo.app.queue");
});

test("placedKinds tracks the budget across pages", () => {
  let { doc } = addPage(null, "One", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  const second = addPage(doc, "Two", DEFAULTS);
  const doc2 = addWidget(second.doc, second.pageId, BROWSE);
  assert.deepEqual(
    [...placedKinds(doc2)].sort(),
    ["evo.app.browse", "evo.app.queue"],
  );
});

test("editor output resolves fully admitted against the catalog", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  for (const kind of APP_WIDGET_KINDS) {
    doc = addWidget(doc, "page-1", kind);
  }
  const resolved = resolveLayout(doc, catalogSnapshot(), "wide");
  const page = resolved.pages.find((p) => p.page.id === "page-1")!;
  for (const slot of page.regions.main!) {
    assert.equal(slot.status.kind, "admitted", slot.slot.widgetKindId);
  }
});

test("baseDocument is a valid skeleton", () => {
  const doc = baseDocument();
  assert.equal(doc.pages[0].id, "landing");
  assert.equal(editablePages(doc).length, 0);
});

/* ------------------------------------------------------------------ */
/* region-aware canvas ops                                             */
/* ------------------------------------------------------------------ */

// Late imports keep the original test body untouched.
import {
  clampSizeFor,
  insertWidgetAt,
  legalSizesFor,
  moveSlot,
  removeSlot,
  setSlotAlign,
  setSlotSize,
  slotAt,
  synthesizeHomePage,
} from "../../src/dev/designer-pages.ts";

const FAVOURITES = catalogKind("evo.app.favourites")!;

// Refusal-path coverage needs a kind no region can host - every real
// catalog kind fits somewhere by design (a rail is a stacked region
// and accepts everything; only the deck gates sizes).
const FAKE_BIG = {
  id: "test.big",
  label: "Big",
  minSize: "half",
  idealSize: "full",
  maxSize: "full",
} as const;

test("legalSizesFor intersects envelope with region contract", () => {
  // rail is a stacked region - it accepts the full envelope
  assert.deepEqual(legalSizesFor(QUEUE, "rail"), [
    "third",
    "half",
    "two-thirds",
    "full",
  ]);
  // deck accepts atom..third -> only third survives for queue
  assert.deepEqual(legalSizesFor(QUEUE, "deck"), ["third"]);
  assert.equal(clampSizeFor(QUEUE, "deck", "full"), "third");
  assert.equal(clampSizeFor(QUEUE, "rail", "half"), "half");
  // a half-minimum kind cannot enter the deck at all
  assert.deepEqual(legalSizesFor(FAKE_BIG, "deck"), []);
  assert.equal(clampSizeFor(FAKE_BIG, "deck", "half"), null);
});

test("insertWidgetAt places at the index with clamped size; refuses impossible regions", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  const mid = insertWidgetAt(doc, "page-1", BROWSE, { region: "main", index: 0 });
  assert.equal(mid.refusal, null);
  assert.deepEqual(mid.address, { region: "main", index: 0 });
  assert.equal(mid.doc.pages[1].regions.main![0].widgetKindId, "evo.app.browse");

  const deck = insertWidgetAt(mid.doc, "page-1", FAVOURITES, { region: "deck", index: null });
  assert.equal(deck.refusal, null);
  assert.equal(deck.doc.pages[1].regions.deck![0].size, "third"); // ideal half clamped

  // rail is a stacked region: queue admits at its ideal size
  const rail = insertWidgetAt(deck.doc, "page-1", QUEUE, { region: "rail", index: null });
  assert.equal(rail.refusal, null);
  assert.equal(rail.doc.pages[1].regions.rail![0].size, "half");

  const refused = insertWidgetAt(rail.doc, "page-1", FAKE_BIG, { region: "deck", index: null });
  assert.notEqual(refused.refusal, null);
  assert.equal(refused.doc, rail.doc); // untouched on refusal
});

test("moveSlot reorders within a region with forward-index adjustment", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  doc = addWidget(doc, "page-1", BROWSE);
  doc = addWidget(doc, "page-1", FAVOURITES);
  // move first (queue) to before index 2 (favourites) -> browse, queue, favourites
  const out = moveSlot(
    doc, "page-1",
    { region: "main", index: 0 },
    { region: "main", index: 2 },
    QUEUE,
  );
  assert.equal(out.refusal, null);
  assert.deepEqual(
    out.doc.pages[1].regions.main!.map((s) => s.widgetKindId),
    ["evo.app.browse", "evo.app.queue", "evo.app.favourites"],
  );
  assert.deepEqual(out.address, { region: "main", index: 1 });
});

test("moveSlot across regions clamps size or refuses with reason", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE); // half on main
  const toDeck = moveSlot(
    doc, "page-1",
    { region: "main", index: 0 },
    { region: "deck", index: null },
    QUEUE,
  );
  assert.equal(toDeck.refusal, null);
  assert.equal(toDeck.doc.pages[1].regions.deck![0].size, "third");
  assert.equal((toDeck.doc.pages[1].regions.main ?? []).length, 0);

  // rail accepts everything: the queue moves in, keeping its size
  const toRail = moveSlot(
    toDeck.doc, "page-1",
    { region: "deck", index: 0 },
    { region: "rail", index: null },
    QUEUE,
  );
  assert.equal(toRail.refusal, null);
  assert.equal(toRail.doc.pages[1].regions.rail![0].size, "third");
  assert.equal((toRail.doc.pages[1].regions.deck ?? []).length, 0);
});

test("synthesizeHomePage decomposes the landing, idempotently; removal keeps menu entries", () => {
  const { doc, pageId } = synthesizeHomePage(null);
  assert.equal(pageId, "home");
  const home = doc.pages.find((p) => p.id === "home")!;
  assert.deepEqual(
    home.regions.main!.map((s) => [s.widgetKindId, s.size]),
    [["evo.app.nowplaying", "full"]],
  );
  assert.deepEqual(
    home.regions.rail!.map((s) => s.widgetKindId),
    ["evo.app.comingnext", "evo.app.volume"],
  );
  assert.equal(synthesizeHomePage(doc).doc, doc);

  // home page resolves fully admitted against the catalog
  const resolved = resolveLayout(doc, catalogSnapshot(), "wide");
  const page = resolved.pages.find((p) => p.page.id === "home")!;
  for (const region of ["main", "rail"] as const) {
    for (const slot of page.regions[region]!) {
      assert.equal(slot.status.kind, "admitted", slot.slot.widgetKindId);
    }
  }

  // removing a view-override page keeps its menu entry
  const withEntry = {
    ...doc,
    nav: { ...doc.nav, entries: [{ type: "page" as const, page: "home" }] },
  };
  const removed = removePage(withEntry, "home", true);
  assert.equal(removed.pages.some((p) => p.id === "home"), false);
  assert.deepEqual(removed.nav.entries, [{ type: "page", page: "home" }]);
});

test("setSlotAlign pins and clears; setSlotSize respects region contract", () => {
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  const at = { region: "main" as const, index: 0 };
  doc = setSlotAlign(doc, "page-1", at, "center");
  assert.equal(slotAt(doc, "page-1", at)?.align, "center");
  doc = setSlotAlign(doc, "page-1", at, "auto");
  assert.equal(slotAt(doc, "page-1", at)?.align, undefined);

  doc = setSlotSize(doc, "page-1", at, "full", QUEUE);
  assert.equal(slotAt(doc, "page-1", at)?.size, "full");
  const unchanged = setSlotSize(doc, "page-1", at, "atom", QUEUE);
  assert.equal(unchanged, doc);

  doc = removeSlot(doc, "page-1", at);
  assert.equal((doc.pages[1].regions.main ?? []).length, 0);
});

test("align round-trips through document decode", async () => {
  const { decodeLayoutDocument } = await import("../../src/runtime/layout-document.ts");
  let { doc } = addPage(null, "Extras", DEFAULTS);
  doc = addWidget(doc, "page-1", QUEUE);
  doc = setSlotAlign(doc, "page-1", { region: "main", index: 0 }, "right");
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(decoded?.pages[1].regions.main?.[0].align, "right");
});

/* ------------------------------------------------------------------ */
/* default views as builder pages (copy-on-write overrides)            */
/* ------------------------------------------------------------------ */

import { synthesizeViewPage } from "../../src/dev/designer-pages.ts";
import { VIEW_PAGE_DEFAULTS } from "../../src/app/widget-catalog.ts";
import { menuItemsFromDocument } from "../../src/dev/designer-menu.ts";

const LIBRARY_DEF = VIEW_PAGE_DEFAULTS.find((d) => d.viewId === "library")!;

test("synthesizeViewPage forks a view into a full-width widget page, idempotently", () => {
  const first = synthesizeViewPage(null, LIBRARY_DEF);
  assert.equal(first.pageId, "library");
  const page = first.doc.pages.find((p) => p.id === "library")!;
  assert.deepEqual(
    page.regions.main!.map((s) => [s.widgetKindId, s.size]),
    [["evo.app.queue", "full"]],
  );
  const again = synthesizeViewPage(first.doc, LIBRARY_DEF);
  assert.equal(again.doc, first.doc);
});

test("an override page replaces its view in curation, even uncurated", () => {
  const { doc } = synthesizeViewPage(null, LIBRARY_DEF);
  // No nav page entries at all - yet the override must surface.
  const curated = curateNavItems(DEFAULTS, doc);
  assert.equal(curated.curated, true);
  assert.deepEqual(curated.items, [
    { kind: "view", id: "home", label: "Home" },
    { kind: "page", pageId: "library", label: "Queue" },
    { kind: "view", id: "system", label: "Settings" },
  ]);
});

test("an override page replaces its view inside explicit entries too", () => {
  let { doc } = synthesizeViewPage(null, LIBRARY_DEF);
  doc = {
    ...doc,
    nav: {
      ...doc.nav,
      entries: [
        { type: "page", page: "home" },
        { type: "page", page: "library", label: "Up next" },
      ],
    },
  };
  const curated = curateNavItems(DEFAULTS, doc);
  assert.deepEqual(curated.items, [
    { kind: "view", id: "home", label: "Home" },
    { kind: "page", pageId: "library", label: "Up next" },
  ]);
});

test("removing the override page restores the built-in view", () => {
  const { doc } = synthesizeViewPage(null, LIBRARY_DEF);
  const restored = removePage(doc, "library");
  const curated = curateNavItems(DEFAULTS, restored);
  assert.equal(curated.curated, false);
  assert.deepEqual(
    curated.items.map((i) => i.kind),
    ["view", "view", "view"],
  );
});

test("menu editor rows do not duplicate an overridden view", () => {
  const { doc } = synthesizeViewPage(null, LIBRARY_DEF);
  const rows = menuItemsFromDocument(DEFAULTS, doc);
  const libraryRows = rows.filter((r) => r.id === "library");
  assert.equal(libraryRows.length, 1);
  assert.equal(libraryRows[0].kind, "page");
});

test("override page resolves admitted and renders the view's widget", () => {
  const { doc } = synthesizeViewPage(null, LIBRARY_DEF);
  const resolved = resolveLayout(doc, catalogSnapshot(), "wide");
  const page = resolved.pages.find((p) => p.page.id === "library")!;
  assert.equal(page.regions.main![0].status.kind, "admitted");
  assert.equal(page.regions.main![0].effectiveSize, "full");
});

test("works: widget kind exists, forks as a default page, and overrides even when the view is gated", () => {
  const WORKS_DEF = VIEW_PAGE_DEFAULTS.find((d) => d.viewId === "works")!;
  assert.notEqual(catalogKind("evo.app.works"), undefined);

  const { doc } = synthesizeViewPage(null, WORKS_DEF);
  const page = doc.pages.find((p) => p.id === "works")!;
  assert.deepEqual(
    page.regions.main!.map((s) => [s.widgetKindId, s.size]),
    [["evo.app.works", "full"]],
  );

  // Defaults WITHOUT works (view auto-gated off): an explicit works
  // entry still surfaces the override page - operator intent wins.
  const gatedDefaults: readonly CuratableNavItem[] = [
    { id: "home", label: "Home" },
    { id: "system", label: "Settings" },
  ];
  const withEntry = {
    ...doc,
    nav: {
      ...doc.nav,
      entries: [
        { type: "page" as const, page: "home" },
        { type: "page" as const, page: "works" },
      ],
    },
  };
  const curated = curateNavItems(gatedDefaults, withEntry);
  assert.deepEqual(curated.items, [
    { kind: "view", id: "home", label: "Home" },
    { kind: "page", pageId: "works", label: "Works" },
  ]);
});
