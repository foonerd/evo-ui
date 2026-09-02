// Designer menu editor - pure model. The designer's Menu tab edits
// the sidebar as data: order, labels, visibility - for built-in views
// AND the document's own pages. The output is the layout document's
// `nav.entries` (runtime/layout-document.ts); the display side
// consumes it through `curateNavItems`, so this module and
// app/nav-curation.ts are the two halves of one contract: whatever
// this builder emits, the curator renders.
//
// A default arrangement (default order, default labels, everything
// visible, no document pages surfaced) stores NO curation:
// `layoutWithMenu` strips the page entries, and drops the document
// entirely when nothing else lives in it. The device then renders its
// stock grouped sidebar - the same inertness gate the display side
// keys on.

import {
  curateNavItems,
  LANDING_NAV_ID,
  type CuratableNavItem,
} from "../app/nav-curation.ts";

import {
  LANDING_PAGE_ID,
  LAYOUT_SCHEMA_VERSION,
  type LayoutDocument,
  type NavEntry,
  type NavMode,
  type NavPosition,
} from "../runtime/layout-document.ts";

export interface MenuEditorItem {
  /** Built-in view, one of the document's own pages, or a group
   *  divider (labelled heading; empty label = plain rule). */
  readonly kind: "view" | "page" | "divider";
  /** NavView id, document page id, or a synthetic divider id. */
  readonly id: string;
  readonly label: string;
  readonly defaultLabel: string;
  readonly visible: boolean;
}

/** Composite row key - view and page ids live in separate spaces. */
export function menuRowKey(item: Pick<MenuEditorItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function dividerRow(id: string, label: string): MenuEditorItem {
  // defaultLabel "" so clearing the input canonically yields a plain
  // rule, mirroring setMenuItemLabel's empty-restores-default rule.
  return { kind: "divider", id, label, defaultLabel: "", visible: true };
}

/** The shipped arrangement as editor rows: each defaults group opens
 *  with its divider, exactly like the stock sidebar renders. This IS
 *  the default - dividers included - so an untouched grouped menu
 *  stores nothing. */
export function defaultMenuRows(
  defaults: readonly CuratableNavItem[]
): MenuEditorItem[] {
  const out: MenuEditorItem[] = [];
  let group: string | undefined;
  let d = 0;
  for (const def of defaults) {
    if (def.group !== undefined && def.group !== group) {
      group = def.group;
      out.push(dividerRow(`default-${d++}`, def.group));
    }
    out.push({
      kind: "view",
      id: def.id,
      label: def.label,
      defaultLabel: def.label,
      visible: true,
    });
  }
  return out;
}

/**
 * Editor rows from the stored document: curated entries first in
 * their stored order (visible), then every default view the document
 * hides, then every document page the menu does not surface - both
 * invisible so the operator can bring them in.
 */
export function menuItemsFromDocument(
  defaults: readonly CuratableNavItem[],
  doc: LayoutDocument | null,
): MenuEditorItem[] {
  const curated = curateNavItems(defaults, doc);
  const byId = new Map(defaults.map((d) => [d.id as string, d]));
  const out: MenuEditorItem[] = [];
  const seen = new Set<string>();

  if (curated.curated) {
    let d = 0;
    for (const item of curated.items) {
      if (item.kind === "divider") {
        out.push(dividerRow(`d${d++}`, item.label));
        continue;
      }
      if (item.kind === "view") {
        const def = byId.get(item.id);
        if (def === undefined) continue;
        seen.add(menuRowKey({ kind: "view", id: item.id }));
        out.push({
          kind: "view",
          id: item.id,
          label: item.label,
          defaultLabel: def.label,
          visible: true,
        });
      } else {
        const page = doc?.pages.find((p) => p.id === item.pageId);
        if (page === undefined) continue;
        seen.add(menuRowKey({ kind: "page", id: item.pageId }));
        out.push({
          kind: "page",
          id: item.pageId,
          label: item.label,
          defaultLabel: page.name,
          visible: true,
        });
      }
    }
    // Defaults the document hides trail the list, dimmed, so the
    // operator can bring them back.
    for (const def of defaults) {
      if (seen.has(menuRowKey({ kind: "view", id: def.id }))) continue;
      // A document page overriding this view id (default builder page)
      // owns the menu slot - the view surfaces as its page row instead.
      // Home is the exception: its page swaps the view's CONTENT, not
      // its menu entry, so the home view row stays.
      if (def.id !== LANDING_NAV_ID && doc?.pages.some((p) => p.id === def.id)) {
        continue;
      }
      out.push({
        kind: "view",
        id: def.id,
        label: def.label,
        defaultLabel: def.label,
        visible: false,
      });
    }
  } else {
    // Untouched menu: the shipped grouped arrangement, dividers and
    // all - editing starts FROM the stock sidebar, not a flat list.
    out.push(...defaultMenuRows(defaults));
    for (const row of out) seen.add(menuRowKey(row));
  }
  for (const page of doc?.pages ?? []) {
    // Landing is never a destination; the home page is the home
    // view's content, not a second menu entry.
    if (page.id === LANDING_PAGE_ID || page.id === LANDING_NAV_ID) continue;
    if (seen.has(menuRowKey({ kind: "page", id: page.id }))) continue;
    out.push({
      kind: "page",
      id: page.id,
      label: page.name,
      defaultLabel: page.name,
      visible: false,
    });
  }
  return out;
}

/** Move a row up (-1) or down (+1); no-op at the edges. */
export function moveMenuItem(
  items: readonly MenuEditorItem[],
  rowKey: string,
  delta: -1 | 1,
): readonly MenuEditorItem[] {
  const i = items.findIndex((item) => menuRowKey(item) === rowKey);
  if (i < 0) return items;
  const j = i + delta;
  if (j < 0 || j >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved);
  return next;
}

/** Toggle visibility. The landing entry can never hide (contract). */
export function setMenuItemVisible(
  items: readonly MenuEditorItem[],
  rowKey: string,
  visible: boolean,
): readonly MenuEditorItem[] {
  if (rowKey === menuRowKey({ kind: "view", id: LANDING_NAV_ID }) && !visible) {
    return items;
  }
  return items.map((item) =>
    menuRowKey(item) === rowKey ? { ...item, visible } : item,
  );
}

/** Rename a row. Empty / whitespace input restores the default label. */
export function setMenuItemLabel(
  items: readonly MenuEditorItem[],
  rowKey: string,
  label: string,
): readonly MenuEditorItem[] {
  const trimmed = label.trim();
  return items.map((item) =>
    menuRowKey(item) === rowKey
      ? { ...item, label: trimmed.length > 0 ? trimmed : item.defaultLabel }
      : item,
  );
}

/** True when the rows equal the stock sidebar - dividers included -
 *  so an untouched grouped menu stores nothing. */
export function isDefaultArrangement(
  items: readonly MenuEditorItem[],
  defaults: readonly CuratableNavItem[],
): boolean {
  const visible = items.filter((item) => item.visible);
  const expected = defaultMenuRows(defaults);
  if (visible.length !== expected.length) return false;
  return visible.every((item, i) => {
    const want = expected[i];
    if (item.kind !== want.kind) return false;
    if (item.kind === "divider") return item.label === want.label;
    return item.id === want.id && item.label === want.label;
  });
}

/** Nav entries for the visible rows; renames only when they differ.
 *  Dividers serialize as divider entries (label omitted when empty -
 *  a plain rule). */
export function navEntriesFromMenuItems(
  items: readonly MenuEditorItem[],
): NavEntry[] {
  return items
    .filter((item) => item.visible)
    .map((item): NavEntry => {
      if (item.kind === "divider") {
        return item.label.length > 0
          ? { type: "divider", label: item.label }
          : { type: "divider" };
      }
      return item.label !== item.defaultLabel
        ? { type: "page", page: item.id, label: item.label }
        : { type: "page", page: item.id };
    });
}

/** Add a fresh divider row (label editable in place). It lands after
 *  the last VISIBLE row - never stranded below the dimmed hidden
 *  tail - and moves anywhere from there with the row movers. */
export function addDivider(
  items: readonly MenuEditorItem[],
): readonly MenuEditorItem[] {
  let n = 0;
  for (const item of items) {
    if (item.kind === "divider") {
      const m = /^new-(\d+)$/.exec(item.id);
      if (m !== null) n = Math.max(n, Number(m[1]) + 1);
    }
  }
  let insertAt = 0;
  items.forEach((item, i) => {
    if (item.visible) insertAt = i + 1;
  });
  const next = [...items];
  next.splice(insertAt, 0, dividerRow(`new-${n}`, "Group"));
  return next;
}

/** Remove a divider row. Views and pages hide via the eye instead -
 *  destinations are never deleted from the menu model. */
export function removeMenuItem(
  items: readonly MenuEditorItem[],
  rowKey: string,
): readonly MenuEditorItem[] {
  return items.filter(
    (item) => item.kind !== "divider" || menuRowKey(item) !== rowKey,
  );
}

/**
 * Merge the editor state into the (possibly absent) stored document.
 *
 * - Default arrangement: page entries are stripped; when the document
 *   holds nothing else worth keeping, `undefined` is returned so the
 *   caller removes the `layout` key entirely (full inertness).
 * - Curated: page entries replace the previous ones. Widget deep-link
 *   entries and the document's pages are preserved untouched - the
 *   menu editor owns exactly one section of the document.
 */
export function layoutWithMenu(
  doc: LayoutDocument | null,
  items: readonly MenuEditorItem[],
  defaults: readonly CuratableNavItem[],
): LayoutDocument | undefined {
  if (isDefaultArrangement(items, defaults)) {
    if (doc === null) return undefined;
    const widgetEntries = doc.nav.entries.filter((e) => e.type === "widget");
    const stripped: LayoutDocument = {
      ...doc,
      nav: { ...doc.nav, entries: widgetEntries },
    };
    return isSkeletonDocument(stripped) ? undefined : stripped;
  }
  const base: LayoutDocument =
    doc ?? {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      pages: [{ id: LANDING_PAGE_ID, name: "Landing", regions: {} }],
      nav: { position: "left", entries: [] },
    };
  const widgetEntries = base.nav.entries.filter((e) => e.type === "widget");
  return {
    ...base,
    nav: {
      ...base.nav,
      entries: [...navEntriesFromMenuItems(items), ...widgetEntries],
    },
  };
}

/**
 * Set the menu's edge. Creates the document skeleton when nothing is
 * stored yet - chrome is operator content in its own right.
 */
export function setNavPosition(
  doc: LayoutDocument | null,
  position: NavPosition,
): LayoutDocument {
  const base = doc ?? emptyDocument();
  return { ...base, nav: { ...base.nav, position } };
}

/** Set pinned vs slide (drawer). */
export function setNavMode(
  doc: LayoutDocument | null,
  mode: NavMode,
): LayoutDocument {
  const base = doc ?? emptyDocument();
  return {
    ...base,
    nav: {
      ...base.nav,
      ...(mode === "slide" ? { mode } : { mode: undefined }),
    },
  };
}

/** Show or hide the power-verb cluster. Pinned is the default and
 *  stores nothing; hidden is operator content. */
export function setNavPower(
  doc: LayoutDocument | null,
  power: "pinned" | "hidden",
): LayoutDocument {
  const base = doc ?? emptyDocument();
  return {
    ...base,
    nav: {
      ...base.nav,
      ...(power === "hidden" ? { power } : { power: undefined }),
    },
  };
}

function emptyDocument(): LayoutDocument {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    pages: [{ id: LANDING_PAGE_ID, name: "Landing", regions: {} }],
    nav: { position: "left", entries: [] },
  };
}

/** True when the document carries no operator content at all -
 *  including chrome: a non-default menu position or mode is content
 *  and must survive a menu reset. */
function isSkeletonDocument(doc: LayoutDocument): boolean {
  if (doc.nav.entries.length > 0) return false;
  if (doc.nav.position !== "left" || doc.nav.mode === "slide") return false;
  if (doc.nav.power === "hidden") return false;
  if (doc.pages.some((page) => page.id !== LANDING_PAGE_ID)) return false;
  return doc.pages.every(
    (page) =>
      Object.values(page.regions).every((slots) => (slots ?? []).length === 0),
  );
}
