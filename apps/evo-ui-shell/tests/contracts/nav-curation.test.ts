import test from "node:test";
import assert from "node:assert/strict";

import {
  curateNavItems,
  splitAtDividers,
  type CuratableNavItem,
} from "../../src/app/nav-curation.ts";

import {
  resolveLayoutDocument,
  type DisplayProfileSettings,
} from "../../src/runtime/presentation-target.ts";

import type {
  LayoutDocument,
  LayoutPage,
  NavEntry,
} from "../../src/runtime/layout-document.ts";

const DEFAULTS: readonly CuratableNavItem[] = [
  { id: "home", label: "Home" },
  { id: "library", label: "Queue" },
  { id: "explore", label: "Browse" },
  { id: "system", label: "Settings" },
  { id: "multiroom", label: "Multi-room" },
];

function docWithNav(
  entries: readonly NavEntry[],
  extraPages: readonly LayoutPage[] = [],
): LayoutDocument {
  return {
    schemaVersion: 1,
    pages: [
      { id: "landing", name: "Landing", regions: {} },
      ...extraPages,
    ],
    nav: { position: "left", entries },
  };
}

test("no document means no curation - defaults pass through as views", () => {
  const out = curateNavItems(DEFAULTS, null);
  assert.equal(out.curated, false);
  assert.deepEqual(
    out.items,
    DEFAULTS.map((d) => ({ kind: "view", id: d.id, label: d.label })),
  );
});

test("document with no matching page entries means no curation", () => {
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([
      { type: "page", page: "no-such-thing" },
      { type: "widget", page: "landing", widgetKindId: "evo.audio.queue.list" },
    ]),
  );
  assert.equal(out.curated, false);
});

test("entries curate order, labels, and visibility", () => {
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([
      { type: "page", page: "system", label: "Device" },
      { type: "page", page: "home" },
      { type: "page", page: "library", label: "Up next" },
    ]),
  );
  assert.equal(out.curated, true);
  assert.deepEqual(out.items, [
    { kind: "view", id: "system", label: "Device" },
    { kind: "view", id: "home", label: "Home" },
    { kind: "view", id: "library", label: "Up next" },
  ]);
});

test("entries matching document pages become page destinations", () => {
  const extras: LayoutPage[] = [
    { id: "page1", name: "Extras", regions: {} },
  ];
  const out = curateNavItems(
    DEFAULTS,
    docWithNav(
      [
        { type: "page", page: "home" },
        { type: "page", page: "page1" },
        { type: "page", page: "page1", label: "dup ignored" },
      ],
      extras,
    ),
  );
  assert.deepEqual(out.items, [
    { kind: "view", id: "home", label: "Home" },
    { kind: "page", pageId: "page1", label: "Extras" },
  ]);
});

test("page entry label renames a document page destination", () => {
  const extras: LayoutPage[] = [
    { id: "page1", name: "Extras", regions: {} },
  ];
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([{ type: "page", page: "page1", label: "My stuff" }], extras),
  );
  assert.deepEqual(out.items, [
    { kind: "view", id: "home", label: "Home" },
    { kind: "page", pageId: "page1", label: "My stuff" },
  ]);
});

test("the landing document page is never a menu destination", () => {
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([
      { type: "page", page: "home" },
      { type: "page", page: "landing" },
    ]),
  );
  assert.deepEqual(out.items, [{ kind: "view", id: "home", label: "Home" }]);
});

test("home is contract - prepended when a document omits it", () => {
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([{ type: "page", page: "system" }]),
  );
  assert.deepEqual(
    out.items.map((i) => (i.kind === "view" ? i.id : i.pageId)),
    ["home", "system"],
  );
});

test("override branch keeps the default GROUPS - headings never silently vanish", () => {
  const GROUPED: readonly CuratableNavItem[] = [
    { id: "home", label: "Home", group: "Listen" },
    { id: "library", label: "Queue", group: "Listen" },
    { id: "system", label: "Settings", group: "Device" },
  ];
  // A document whose pages override views (the reference document
  // does this for every view) but whose nav has no usable entries.
  const out = curateNavItems(
    GROUPED,
    docWithNav([], [{ id: "library", name: "Queue", regions: {} }]),
  );
  assert.equal(out.curated, true);
  assert.deepEqual(
    out.items.map((i) =>
      i.kind === "divider"
        ? ["divider", i.label]
        : [i.kind, i.kind === "view" ? i.id : i.pageId],
    ),
    [
      ["divider", "Listen"],
      ["view", "home"],
      ["page", "library"],
      ["divider", "Device"],
      ["view", "system"],
    ],
  );
});

test("dividers pass through in position; home still prepends at the very top", () => {
  const out = curateNavItems(
    DEFAULTS,
    docWithNav([
      { type: "divider", label: "Player" },
      { type: "page", page: "library" },
      { type: "divider" },
      { type: "page", page: "system" },
    ]),
  );
  assert.equal(out.curated, true);
  assert.deepEqual(
    out.items.map((i) =>
      i.kind === "divider" ? ["divider", i.label] : ["dest", i.kind === "view" ? i.id : i.pageId],
    ),
    [
      ["dest", "home"],
      ["divider", "Player"],
      ["dest", "library"],
      ["divider", ""],
      ["dest", "system"],
    ],
  );
});

test("splitAtDividers: leading group is unheaded - every heading is operator data", () => {
  const grouped = splitAtDividers([
    { kind: "view", id: "home", label: "Home" },
    { kind: "divider", label: "Device" },
    { kind: "view", id: "system", label: "Settings" },
  ]);
  assert.deepEqual(
    grouped.map((g) => [g.label, g.items.length]),
    [
      [null, 1],
      ["Device", 1],
    ],
  );
  // A menu with no dividers at all renders one unheaded group -
  // nothing forced on an operator who deleted every heading.
  const flat = splitAtDividers([{ kind: "view", id: "home", label: "Home" }]);
  assert.deepEqual(flat.map((g) => [g.label, g.items.length]), [[null, 1]]);
  // Menu starting WITH a divider gets no stray empty leading group.
  const noLead = splitAtDividers([
    { kind: "divider", label: "Listen" },
    { kind: "view", id: "home", label: "Home" },
    { kind: "divider", label: "" },
  ]);
  assert.deepEqual(
    noLead.map((g) => [g.label, g.items.length]),
    [
      ["Listen", 1],
      ["", 0],
    ],
  );
});

test("resolveLayoutDocument: strictly per-target - custom.layout RETIRED", () => {
  const targetDoc = docWithNav([{ type: "page", page: "home" }]);
  const customDoc = docWithNav([{ type: "page", page: "system" }]);
  const settings: DisplayProfileSettings = {
    byTarget: { "1280x720@7": { displayFactor: 1, layout: targetDoc } },
    custom: { layout: customDoc },
  };
  // A screen with a matched profile gets ITS design - an 800x480
  // panel and a 4K browser are different designs by requirement.
  assert.equal(resolveLayoutDocument("1280x720@7", settings), targetDoc);
  // Screens without their own layout get SHIPPED DEFAULTS (null) -
  // the generic custom slot no longer leaks stale arrangements.
  assert.equal(resolveLayoutDocument("800x480@5", settings), null);
  assert.equal(resolveLayoutDocument(null, settings), null);
  const targetOnly: DisplayProfileSettings = {
    byTarget: { "1280x720@7": { displayFactor: 1, layout: targetDoc } },
  };
  assert.equal(resolveLayoutDocument("1280x720@7", targetOnly), targetDoc);
  assert.equal(resolveLayoutDocument("800x480@5", targetOnly), null);
  assert.equal(resolveLayoutDocument(null, null), null);
});
