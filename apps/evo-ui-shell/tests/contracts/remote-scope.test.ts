import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveLayoutDocument,
  resolveRemoteLayoutDocument,
  type DisplayProfileSettings,
} from "../../src/runtime/presentation-target.ts";
import {
  mergeCustomDisplayProfile,
  mergeRemoteDisplayProfile,
  mergeTargetDisplayProfile,
  parseDisplayProfileSettings,
} from "../../src/runtime/ui-profile.ts";
import { resolveLayout } from "../../src/runtime/layout-document.ts";
import type { LayoutDocument } from "../../src/runtime/layout-document.ts";
import {
  APP_WIDGET_KINDS,
  catalogSnapshot,
  DEFAULT_HOME_PAGE,
  synthesizeRemoteReference,
  VIEW_PAGE_DEFAULTS,
} from "../../src/app/widget-catalog.ts";

const DOC: LayoutDocument = {
  schemaVersion: 1,
  pages: [{ id: "home", name: "Home", regions: {} }],
  nav: { position: "left", entries: [] },
};

test("remote scope resolves only the remote slot - never byTarget/custom", () => {
  const settings: DisplayProfileSettings = {
    byTarget: { "800x480@5": { displayFactor: 1, layout: DOC } },
    custom: { layout: DOC },
  };
  assert.equal(resolveRemoteLayoutDocument(settings), null);
  const withRemote = mergeRemoteDisplayProfile(settings, { layout: DOC });
  assert.equal(resolveRemoteLayoutDocument(withRemote), DOC);
  // And native resolution never reads the remote slot.
  const remoteOnly: DisplayProfileSettings = { remote: { layout: DOC } };
  assert.equal(resolveLayoutDocument("800x480@5", remoteOnly), null);
  assert.equal(resolveLayoutDocument(null, remoteOnly), null);
});

test("remote slot survives the parse round-trip", () => {
  const merged = mergeRemoteDisplayProfile(null, { layout: DOC });
  const parsed = parseDisplayProfileSettings(JSON.parse(JSON.stringify(merged)));
  assert.notEqual(parsed, null);
  assert.notEqual(resolveRemoteLayoutDocument(parsed), null);
});

test("scope writes are independent - no merge clobbers another scope", () => {
  let s: DisplayProfileSettings | null = null;
  s = mergeRemoteDisplayProfile(s, { layout: DOC });
  s = mergeTargetDisplayProfile(s, "800x480@5", { layout: DOC });
  s = mergeCustomDisplayProfile(s, { displayFactor: 1.2 });
  assert.notEqual(resolveRemoteLayoutDocument(s), null);
  assert.notEqual(resolveLayoutDocument("800x480@5", s), null);
  assert.equal(s.custom?.displayFactor, 1.2);
  // Reset remote: only the remote scope changes.
  s = mergeRemoteDisplayProfile(s, { layout: undefined });
  assert.equal(resolveRemoteLayoutDocument(s), null);
  assert.notEqual(resolveLayoutDocument("800x480@5", s), null);
});

test("the derived reference is complete: every catalog kind placed, home + every view page", () => {
  const ref = synthesizeRemoteReference();
  assert.equal(ref.pages[0], DEFAULT_HOME_PAGE);
  for (const v of VIEW_PAGE_DEFAULTS) {
    assert.ok(
      ref.pages.some((p) => p.id === v.viewId),
      `reference page for view ${v.viewId}`
    );
  }
  const placed = new Set<string>();
  for (const page of ref.pages) {
    for (const slots of Object.values(page.regions)) {
      for (const slot of slots ?? []) placed.add(slot.widgetKindId);
    }
  }
  for (const kind of APP_WIDGET_KINDS) {
    assert.ok(placed.has(kind.id), `reference places ${kind.id}`);
  }
});

test("the derived reference resolves with zero refusals at every breakpoint", () => {
  const ref = synthesizeRemoteReference();
  for (const bp of ["compact", "regular", "wide"] as const) {
    const resolved = resolveLayout(ref, catalogSnapshot(), bp);
    for (const page of resolved.pages) {
      for (const region of Object.values(page.regions)) {
        for (const slot of region ?? []) {
          assert.equal(
            slot.status.kind,
            "admitted",
            `${page.page.id}: ${slot.slot.widgetKindId} is ${slot.status.kind} at ${bp}`
          );
        }
      }
    }
  }
});

test("RETIRED: custom.layout never resolves for native - strictly per-target", () => {
  // The pre-target generic slot leaked a stale two-thirds arrangement
  // into every screen without a stored layout. Retired: a target key
  // resolves its own document or null (shipped defaults) - never the
  // custom slot, even when custom.layout is present.
  const s: DisplayProfileSettings = {
    custom: { widthPx: 800, heightPx: 480, layout: DOC },
  };
  assert.equal(resolveLayoutDocument("800x800@3.4", s), null);
  assert.equal(resolveLayoutDocument(null, s), null);
  assert.equal(resolveLayoutDocument(undefined, s), null);
  // A target's own document still resolves.
  const withTarget = mergeTargetDisplayProfile(s, "800x800@3.4", { layout: DOC });
  assert.notEqual(resolveLayoutDocument("800x800@3.4", withTarget), null);
});
