import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_WIDGET_KINDS,
  catalogSnapshot,
} from "../../src/app/widget-catalog.ts";

import {
  resolveLayout,
  type LayoutDocument,
} from "../../src/runtime/layout-document.ts";

test("catalog snapshot funds each kind exactly once", () => {
  const snap = catalogSnapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          main: [
            { widgetKindId: "evo.app.queue", size: "half", foldPriority: 3 },
            { widgetKindId: "evo.app.queue", size: "half", foldPriority: 3 },
            { widgetKindId: "evo.app.missing", size: "half", foldPriority: 3 },
          ],
        },
      },
    ],
    nav: { position: "left", entries: [] },
  };
  const resolved = resolveLayout(doc, snap, "wide");
  const statuses = resolved.pages[0].regions.main!.map((s) => s.status.kind);
  assert.deepEqual(statuses, ["admitted", "unavailable", "unavailable"]);
});

test("every catalog kind resolves admitted at its ideal size on main", () => {
  const snap = catalogSnapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          main: APP_WIDGET_KINDS.map((kind) => ({
            widgetKindId: kind.id,
            size: kind.idealSize,
            foldPriority: 3 as const,
          })),
        },
      },
    ],
    nav: { position: "left", entries: [] },
  };
  const resolved = resolveLayout(doc, snap, "wide");
  for (const slot of resolved.pages[0].regions.main!) {
    assert.equal(slot.status.kind, "admitted", slot.slot.widgetKindId);
  }
});

test("envelope clamps still apply through the catalog", () => {
  const snap = catalogSnapshot();
  const doc: LayoutDocument = {
    schemaVersion: 1,
    pages: [
      {
        id: "landing",
        name: "Landing",
        regions: {
          // queue min is third - atom must refuse, not shrink.
          main: [
            { widgetKindId: "evo.app.queue", size: "atom", foldPriority: 3 },
          ],
        },
      },
    ],
    nav: { position: "left", entries: [] },
  };
  const resolved = resolveLayout(doc, snap, "wide");
  assert.equal(resolved.pages[0].regions.main![0].status.kind, "refused");
});
