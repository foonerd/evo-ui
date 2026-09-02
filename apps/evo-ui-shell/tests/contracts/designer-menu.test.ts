import test from "node:test";
import assert from "node:assert/strict";

import {
  addDivider,
  isDefaultArrangement,
  layoutWithMenu,
  menuItemsFromDocument,
  moveMenuItem,
  navEntriesFromMenuItems,
  removeMenuItem,
  setMenuItemLabel,
  setMenuItemVisible,
} from "../../src/dev/designer-menu.ts";

import { curateNavItems } from "../../src/app/nav-curation.ts";
import type { CuratableNavItem } from "../../src/app/nav-curation.ts";
import type { LayoutDocument, LayoutPage } from "../../src/runtime/layout-document.ts";

const DEFAULTS: readonly CuratableNavItem[] = [
  { id: "home", label: "Home" },
  { id: "library", label: "Queue" },
  { id: "explore", label: "Browse" },
  { id: "system", label: "Settings" },
];

function docWith(
  entries: LayoutDocument["nav"]["entries"],
  extraPages: readonly LayoutPage[] = [],
): LayoutDocument {
  return {
    schemaVersion: 1,
    pages: [{ id: "landing", name: "Landing", regions: {} }, ...extraPages],
    nav: { position: "left", entries },
  };
}

test("no document yields default view rows, all visible", () => {
  const items = menuItemsFromDocument(DEFAULTS, null);
  assert.deepEqual(
    items.map((i) => [i.kind, i.id, i.label, i.visible]),
    DEFAULTS.map((d) => ["view", d.id, d.label, true]),
  );
  assert.equal(isDefaultArrangement(items, DEFAULTS), true);
});

test("curated document yields curated order plus hidden tail", () => {
  const items = menuItemsFromDocument(
    DEFAULTS,
    docWith([
      { type: "page", page: "system", label: "Device" },
      { type: "page", page: "home" },
    ]),
  );
  assert.deepEqual(
    items.map((i) => [i.id, i.label, i.visible]),
    [
      ["system", "Device", true],
      ["home", "Home", true],
      ["library", "Queue", false],
      ["explore", "Browse", false],
    ],
  );
  assert.equal(isDefaultArrangement(items, DEFAULTS), false);
});

test("document pages appear as rows - surfaced or hidden tail", () => {
  const extras: LayoutPage[] = [{ id: "page1", name: "Extras", regions: {} }];
  const surfaced = menuItemsFromDocument(
    DEFAULTS,
    docWith(
      [
        { type: "page", page: "home" },
        { type: "page", page: "page1", label: "My stuff" },
      ],
      extras,
    ),
  );
  assert.deepEqual(
    surfaced.filter((i) => i.kind === "page").map((i) => [i.id, i.label, i.visible]),
    [["page1", "My stuff", true]],
  );

  const unsurfaced = menuItemsFromDocument(DEFAULTS, docWith([], extras));
  assert.deepEqual(
    unsurfaced.filter((i) => i.kind === "page").map((i) => [i.id, i.label, i.visible]),
    [["page1", "Extras", false]],
  );
});

test("move clamps at edges; visibility lock on home; empty rename restores default", () => {
  let items = menuItemsFromDocument(DEFAULTS, null);
  assert.equal(moveMenuItem(items, "view:home", -1), items);
  items = moveMenuItem(items, "view:library", -1);
  assert.deepEqual(items.map((i) => i.id).slice(0, 2), ["library", "home"]);
  assert.equal(setMenuItemVisible(items, "view:home", false), items);
  items = setMenuItemLabel(items, "view:explore", "  Music  ");
  assert.equal(items.find((i) => i.id === "explore")?.label, "Music");
  items = setMenuItemLabel(items, "view:explore", "   ");
  assert.equal(items.find((i) => i.id === "explore")?.label, "Browse");
});

test("entries carry labels only for renames, doc pages included", () => {
  const extras: LayoutPage[] = [{ id: "page1", name: "Extras", regions: {} }];
  let items = menuItemsFromDocument(DEFAULTS, docWith([], extras));
  items = setMenuItemLabel(items, "view:system", "Device");
  items = setMenuItemVisible(items, "view:explore", false);
  items = setMenuItemVisible(items, "page:page1", true);
  assert.deepEqual(navEntriesFromMenuItems(items), [
    { type: "page", page: "home" },
    { type: "page", page: "library" },
    { type: "page", page: "system", label: "Device" },
    { type: "page", page: "page1" },
  ]);
});

test("layoutWithMenu: default arrangement stores nothing", () => {
  const items = menuItemsFromDocument(DEFAULTS, null);
  assert.equal(layoutWithMenu(null, items, DEFAULTS), undefined);
});

test("layoutWithMenu: default arrangement strips page entries but keeps real content", () => {
  const withWidgets: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          main: [
            {
              widgetKindId: "evo.audio.queue.list",
              size: "half",
              foldPriority: 3,
            },
          ],
        },
      },
    ],
    nav: {
      position: "left",
      entries: [
        { type: "page", page: "system" },
        { type: "widget", page: "landing", widgetKindId: "evo.audio.queue.list" },
      ],
    },
  };
  const items = menuItemsFromDocument(DEFAULTS, null);
  const out = layoutWithMenu(withWidgets, items, DEFAULTS);
  assert.notEqual(out, undefined);
  assert.deepEqual(out!.nav.entries, [
    { type: "widget", page: "landing", widgetKindId: "evo.audio.queue.list" },
  ]);
  assert.equal(out!.pages[0].regions.main!.length, 1);
});

test("layoutWithMenu: document with custom pages never drops to undefined", () => {
  const extras: LayoutPage[] = [{ id: "page1", name: "Extras", regions: {} }];
  const doc = docWith([], extras);
  const items = menuItemsFromDocument(DEFAULTS, null);
  const out = layoutWithMenu(doc, items, DEFAULTS);
  assert.notEqual(out, undefined);
  assert.equal(out!.pages.length, 2);
});

test("layoutWithMenu: skeleton document clears entirely on reset", () => {
  const skeleton = docWith([{ type: "page", page: "system" }]);
  const items = menuItemsFromDocument(DEFAULTS, null);
  assert.equal(layoutWithMenu(skeleton, items, DEFAULTS), undefined);
});

test("round trip: builder output re-derives identically and curates identically", () => {
  const extras: LayoutPage[] = [{ id: "page1", name: "Extras", regions: {} }];
  const doc = docWith([], extras);
  let items = menuItemsFromDocument(DEFAULTS, doc);
  items = moveMenuItem(items, "view:system", -1);
  items = moveMenuItem(items, "view:system", -1);
  items = moveMenuItem(items, "view:system", -1);
  items = setMenuItemLabel(items, "view:system", "Device");
  items = setMenuItemVisible(items, "view:explore", false);
  items = setMenuItemVisible(items, "page:page1", true);

  const next = layoutWithMenu(doc, items, DEFAULTS)!;
  const rederived = menuItemsFromDocument(DEFAULTS, next);
  // Canonical form: visible rows keep their exact order and labels;
  // hidden rows collect at the tail.
  assert.deepEqual(
    rederived.filter((i) => i.visible),
    items.filter((i) => i.visible),
  );
  assert.deepEqual(
    new Set(rederived.filter((i) => !i.visible).map((i) => `${i.kind}:${i.id}`)),
    new Set(items.filter((i) => !i.visible).map((i) => `${i.kind}:${i.id}`)),
  );
  // Idempotence: re-deriving the canonical form is a fixed point.
  const again = layoutWithMenu(next, rederived, DEFAULTS)!;
  assert.deepEqual(menuItemsFromDocument(DEFAULTS, again), rederived);

  const curated = curateNavItems(DEFAULTS, next);
  assert.equal(curated.curated, true);
  assert.deepEqual(
    curated.items.map((i) =>
      i.kind === "view" ? ["view", i.id, i.label] : ["page", i.pageId, i.label],
    ),
    [
      ["view", "system", "Device"],
      ["view", "home", "Home"],
      ["view", "library", "Queue"],
      ["page", "page1", "Extras"],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* dividers (labelled menu groups)                                     */
/* ------------------------------------------------------------------ */

const GROUPED_DEFAULTS: readonly CuratableNavItem[] = [
  { id: "home", label: "Home", group: "Listen" },
  { id: "library", label: "Queue", group: "Listen" },
  { id: "system", label: "Settings", group: "Device" },
  { id: "multiroom", label: "Multi-room", group: "Output" },
];

test("grouped defaults seed the editor with dividers and store nothing", () => {
  const items = menuItemsFromDocument(GROUPED_DEFAULTS, null);
  assert.deepEqual(
    items.map((i) => [i.kind, i.kind === "divider" ? i.label : i.id]),
    [
      ["divider", "Listen"],
      ["view", "home"],
      ["view", "library"],
      ["divider", "Device"],
      ["view", "system"],
      ["divider", "Output"],
      ["view", "multiroom"],
    ],
  );
  assert.equal(isDefaultArrangement(items, GROUPED_DEFAULTS), true);
  assert.equal(layoutWithMenu(null, items, GROUPED_DEFAULTS), undefined);
});

test("adding, renaming, and serializing a divider round-trips", () => {
  let items = menuItemsFromDocument(DEFAULTS, null);
  items = addDivider(items);
  items = setMenuItemLabel(items, "divider:new-0", "Extras");
  items = moveMenuItem(items, "divider:new-0", -1);
  assert.equal(isDefaultArrangement(items, DEFAULTS), false);

  const entries = navEntriesFromMenuItems(items);
  assert.deepEqual(entries[entries.length - 2], {
    type: "divider",
    label: "Extras",
  });

  const doc = layoutWithMenu(null, items, DEFAULTS)!;
  const rederived = menuItemsFromDocument(DEFAULTS, doc);
  assert.deepEqual(
    rederived.filter((i) => i.visible).map((i) => [i.kind, i.label]),
    items.filter((i) => i.visible).map((i) => [i.kind, i.label]),
  );
});

test("empty divider label serializes without a label (plain rule)", () => {
  let items = menuItemsFromDocument(DEFAULTS, null);
  items = addDivider(items);
  const entries = navEntriesFromMenuItems(
    setMenuItemLabel(items, "divider:new-0", "   "),
  );
  assert.deepEqual(entries[entries.length - 1], { type: "divider" });
});

test("a new divider lands after the last visible row, above the hidden tail", () => {
  let items = menuItemsFromDocument(DEFAULTS, null);
  items = setMenuItemVisible(items, "view:system", false);
  const doc = layoutWithMenu(null, items, DEFAULTS)!;
  // Canonical rows: three visible, hidden system at the tail.
  let rows = menuItemsFromDocument(DEFAULTS, doc);
  rows = addDivider(rows);
  const dividerIndex = rows.findIndex((i) => i.kind === "divider");
  const lastVisibleDest = rows.reduce(
    (acc, item, i) => (item.visible && item.kind !== "divider" ? i : acc),
    -1,
  );
  assert.equal(dividerIndex, lastVisibleDest + 1);
  assert.equal(rows[rows.length - 1].visible, false);
});

test("removeMenuItem removes dividers only - destinations are immune", () => {
  let items = menuItemsFromDocument(DEFAULTS, null);
  items = addDivider(items);
  assert.equal(removeMenuItem(items, "view:home").length, items.length);
  const removed = removeMenuItem(items, "divider:new-0");
  assert.equal(removed.length, items.length - 1);
  assert.equal(removed.some((i) => i.kind === "divider"), false);
});

test("dividers alone never activate curation on the device", () => {
  const doc = docWith([{ type: "divider", label: "Lonely" }]);
  assert.equal(curateNavItems(DEFAULTS, doc).curated, false);
});

/* ------------------------------------------------------------------ */
/* menu chrome (position / mode) and rail side                         */
/* ------------------------------------------------------------------ */

import { setNavMode, setNavPosition, setNavPower } from "../../src/dev/designer-menu.ts";
import { setPageRailOpacity, setPageRailPosition } from "../../src/dev/designer-pages.ts";
import { decodeLayoutDocument } from "../../src/runtime/layout-document.ts";

test("nav chrome ops create the skeleton and round-trip through decode", () => {
  let doc = setNavPosition(null, "right");
  doc = setNavMode(doc, "slide");
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(doc)))!;
  assert.equal(decoded.nav.position, "right");
  assert.equal(decoded.nav.mode, "slide");
  // pinned clears the field entirely
  const pinned = setNavMode(decoded, "pinned");
  assert.equal(JSON.stringify(pinned).includes('"mode"'), false);
});

test("power cluster dial: hidden stores, pinned clears, decode round-trips, reset preserves", () => {
  let doc = setNavPower(null, "hidden");
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(doc)))!;
  assert.equal(decoded.nav.power, "hidden");
  // Pinned is the default and stores no field at all.
  const pinned = setNavPower(decoded, "pinned");
  assert.equal(JSON.stringify(pinned).includes('"power"'), false);
  // A hidden power cluster is operator content: menu reset keeps it.
  const items = menuItemsFromDocument(DEFAULTS, doc);
  const out = layoutWithMenu(doc, items, DEFAULTS);
  assert.notEqual(out, undefined);
  assert.equal(out!.nav.power, "hidden");
  // And an otherwise-skeleton doc with pinned power clears entirely.
  assert.equal(layoutWithMenu(pinned, items, DEFAULTS), undefined);
});

test("menu reset preserves chrome - position/mode are operator content", () => {
  const withChrome = setNavPosition(null, "right");
  const items = menuItemsFromDocument(DEFAULTS, withChrome);
  const out = layoutWithMenu(withChrome, items, DEFAULTS);
  assert.notEqual(out, undefined);
  assert.equal(out!.nav.position, "right");
});

test("rail opacity: clamps, stores only non-zero, round-trips through decode", () => {
  const base = docWith([]);
  const withPage = {
    ...base,
    pages: [...base.pages, { id: "p", name: "P", regions: {} }],
  };
  const dialed = setPageRailOpacity(withPage, "p", 0.45);
  assert.equal(dialed.pages[1].railOpacity, 0.45);
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(dialed)))!;
  assert.equal(decoded.pages[1].railOpacity, 0.45);
  // Zero is the default and stores nothing.
  const cleared = setPageRailOpacity(dialed, "p", 0);
  assert.equal("railOpacity" in cleared.pages[1], false);
  // Clamp both ends; decode drops a zero written by hand.
  assert.equal(setPageRailOpacity(withPage, "p", 7).pages[1].railOpacity, 1);
  const handZero = JSON.parse(JSON.stringify(dialed));
  handZero.pages[1].railOpacity = 0;
  assert.equal("railOpacity" in decodeLayoutDocument(handZero)!.pages[1], false);
});

test("rail side stores only the non-default and round-trips", () => {
  const base = docWith([]);
  const left = setPageRailPosition(
    { ...base, pages: [...base.pages, { id: "p", name: "P", regions: {} }] },
    "p",
    "left",
  );
  assert.equal(left.pages[1].railPosition, "left");
  const decoded = decodeLayoutDocument(JSON.parse(JSON.stringify(left)))!;
  assert.equal(decoded.pages[1].railPosition, "left");
  const back = setPageRailPosition(left, "p", "right");
  assert.equal(back.pages[1].railPosition, undefined);
});
