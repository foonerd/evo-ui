// Nav curation: the sidebar menu as operator data.
//
// The layout document's `nav.entries` (see runtime/layout-document.ts)
// curate the sidebar: entry order is menu order, entry labels rename,
// and known views absent from the entries are hidden. Entries whose
// page id matches one of the document's own pages surface that page
// as a menu destination (rendered by DocPageView); ids known to
// neither side are ignored rather than refused, so a document written
// against an older shell keeps working after an update.
//
// Contract: "home" is the landing rest and is always present — a
// document that omits it gets it prepended, never dropped. The
// system-action cluster (alarms / update / power) is pinned chrome
// owned by SidebarSystemActions and is not curatable here.
//
// No document (or a document with no usable page entries) means no
// curation: the caller renders its hard-coded groups exactly as
// before. This is the activation gate that keeps incomplete builder
// states inert on deployed targets.

import { LANDING_PAGE_ID, type LayoutDocument } from "../runtime/layout-document.ts";
import type { NavView } from "./nav-types.ts";

/** A default (built-in view) row offered to curation. */
export interface CuratableNavItem {
  readonly id: NavView;
  readonly label: string;
  /** Shipped sidebar group this view belongs to (Listen / Device /
   *  Output). The editor seeds curation with these as dividers, so
   *  the default grouping is a pre-made arrangement of the same
   *  blocks - not a hard-coded special case. */
  readonly group?: string;
}

/** One rendered menu entry: a built-in view, a document page, or a
 *  group divider (labelled heading; empty label = plain rule). */
export type CuratedNavEntry =
  | { readonly kind: "view"; readonly id: NavView; readonly label: string }
  | { readonly kind: "page"; readonly pageId: string; readonly label: string }
  | { readonly kind: "divider"; readonly label: string };

export interface CuratedNav {
  /** True when a document curated the menu; false = defaults. */
  readonly curated: boolean;
  readonly items: readonly CuratedNavEntry[];
}

export const LANDING_NAV_ID: NavView = "home";

/** A destination entry (divider excluded) - what group members are. */
export type CuratedNavDestination = Exclude<
  CuratedNavEntry,
  { kind: "divider" }
>;

export interface CuratedNavGroup {
  /** Group heading. A string renders a title ("" renders a plain
   *  rule); null is the leading pre-divider group, which renders NO
   *  heading - every heading on the glass comes from a divider the
   *  operator placed, named, and can remove. Nothing is forced. */
  readonly label: string | null;
  readonly items: readonly CuratedNavDestination[];
}

/** Split a curated item list into renderable groups at its dividers.
 *  Items before the first divider form the unheaded leading group; a
 *  leading group with no items is dropped (a menu that STARTS with a
 *  divider gets no stray empty gap). Later empty groups render - the
 *  operator sees exactly what they built. */
export function splitAtDividers(
  items: readonly CuratedNavEntry[]
): readonly CuratedNavGroup[] {
  const groups: { label: string | null; items: CuratedNavDestination[] }[] = [
    { label: null, items: [] },
  ];
  for (const item of items) {
    if (item.kind === "divider") {
      groups.push({ label: item.label, items: [] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }
  if (groups[0].items.length === 0) {
    groups.shift();
  }
  return groups;
}

/**
 * Apply a layout document's nav entries to the default nav items.
 *
 * - `doc` null, or no `page` entries matching a default item or a
 *   document page — no curation, defaults pass through untouched.
 * - Otherwise: entry order wins, entry `label` renames, defaults not
 *   referenced are hidden, entries matching document pages become
 *   page destinations, unknown ids are skipped, duplicates collapse
 *   to first occurrence, and `home` is always present.
 */
export function curateNavItems(
  defaults: readonly CuratableNavItem[],
  doc: LayoutDocument | null,
): CuratedNav {
  const defaultEntries: CuratedNavEntry[] = defaults.map((item) => ({
    kind: "view",
    id: item.id,
    label: item.label,
  }));
  if (doc === null) {
    return { curated: false, items: defaultEntries };
  }
  const byId = new Map(defaults.map((item) => [item.id as string, item]));
  const docPages = new Map(
    doc.pages
      .filter((page) => page.id !== LANDING_PAGE_ID)
      .map((page) => [page.id, page]),
  );
  // Default views become builder pages by override: a document page
  // carrying a view's id REPLACES that view (copy-on-write default
  // pages - untouched views store nothing). "home" is reserved until
  // the landing surface is document-driven.
  const overridden = (id: string): boolean =>
    id !== LANDING_NAV_ID && docPages.has(id);

  const items: CuratedNavEntry[] = [];
  const seen = new Set<string>();
  for (const entry of doc.nav.entries) {
    if (entry.type === "divider") {
      // Grouping chrome passes through in position; it never counts
      // as a usable destination for the activation gate below.
      items.push({ kind: "divider", label: entry.label ?? "" });
      continue;
    }
    if (entry.type !== "page" || seen.has(entry.page)) continue;
    const view = byId.get(entry.page);
    if (view !== undefined && !overridden(entry.page)) {
      seen.add(entry.page);
      items.push({
        kind: "view",
        id: view.id,
        label: entry.label ?? view.label,
      });
      continue;
    }
    const page = entry.page !== LANDING_NAV_ID ? docPages.get(entry.page) : undefined;
    if (page !== undefined) {
      seen.add(entry.page);
      items.push({
        kind: "page",
        pageId: page.id,
        label: entry.label ?? page.name,
      });
    }
  }
  if (!items.some((item) => item.kind !== "divider")) {
    // No usable DESTINATIONS (dividers alone are not a menu). The
    // overridden-defaults branch still curates: the stock grouped
    // sidebar cannot render an override, so the menu renders the
    // DEFAULT ARRANGEMENT - groups included, exactly like the seed -
    // with override pages substituted in place. (This branch once
    // emitted the defaults flat; that silently deleted every group
    // heading from override menus - the reference view among them.)
    if (!defaults.some((item) => overridden(item.id))) {
      return { curated: false, items: defaultEntries };
    }
    const grouped: CuratedNavEntry[] = [];
    let group: string | undefined;
    for (const item of defaults) {
      if (item.group !== undefined && item.group !== group) {
        group = item.group;
        grouped.push({ kind: "divider", label: item.group });
      }
      grouped.push(
        overridden(item.id)
          ? {
              kind: "page",
              pageId: item.id,
              label: docPages.get(item.id)!.name,
            }
          : { kind: "view", id: item.id, label: item.label },
      );
    }
    return { curated: true, items: grouped };
  }
  if (!seen.has(LANDING_NAV_ID)) {
    const home = byId.get(LANDING_NAV_ID);
    if (home !== undefined) {
      items.unshift({ kind: "view", id: home.id, label: home.label });
    }
  }
  return { curated: true, items };
}
