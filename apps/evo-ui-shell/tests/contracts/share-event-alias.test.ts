// Contract: Sources activity paints the operator alias, never a bare
// share_id, including after remove.
//
// Field failure: the Activity line was `share?.alias ?? ev.shareId`,
// resolved at paint time from the configured list. The ring is
// republished whole on every change and the record is gone the moment
// a share is removed, so every line about a removed share degraded to
// a UUID - exactly when the operator most wants to read what happened.
// The name is now stamped onto each event at ingest: a non-blank wire
// alias wins and teaches the memory; otherwise the name the page has
// learned for that share_id; a blank never wipes a remembered name; an
// id is never painted as a name.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeShareEvents,
  type ShareEventItem
} from "../../src/features/sources/share-decoders.ts";
import {
  nonBlank,
  rememberShareAliases,
  stampEventAliases,
  type ShareAliasMemory
} from "../../src/features/sources/share-event-alias.ts";

const ID = "86cb08ee-8e75-4fd9-9b98-28c51468cac5";

const ev = (over: Partial<ShareEventItem> = {}): ShareEventItem => ({
  shareId: ID,
  alias: null,
  kind: "mount_failed",
  detail: "mount error(13): Permission denied",
  negotiatedVersion: null,
  atMs: 1,
  ...over
});

test("ingest stamps alias from configured", () => {
  const memory: ShareAliasMemory = new Map();
  rememberShareAliases(memory, [{ shareId: ID, alias: "Audio" }]);
  const stamped = stampEventAliases([ev()], memory);
  assert.equal(stamped[0].alias, "Audio");
});

test("after that share is gone the line still has the name", () => {
  const memory: ShareAliasMemory = new Map();
  rememberShareAliases(memory, [{ shareId: ID, alias: "Audio" }]);
  // The share is removed: the configured list is empty, and the ring
  // is republished whole with no alias on the wire.
  rememberShareAliases(memory, []);
  const republished = stampEventAliases([ev({ kind: "unmounted" }), ev()], memory);
  assert.deepEqual(
    republished.map((e) => e.alias),
    ["Audio", "Audio"]
  );
});

test("wire alias wins when non-empty, and teaches the memory", () => {
  const memory: ShareAliasMemory = new Map([[ID, "Old name"]]);
  const stamped = stampEventAliases([ev({ alias: "Renamed" })], memory);
  assert.equal(stamped[0].alias, "Renamed");
  assert.equal(memory.get(ID), "Renamed");
  // A later event without an alias now carries the taught name.
  assert.equal(stampEventAliases([ev()], memory)[0].alias, "Renamed");
});

test("blank wire alias does not wipe a stamped name", () => {
  const memory: ShareAliasMemory = new Map([[ID, "Audio"]]);
  for (const blank of ["", "   "]) {
    const stamped = stampEventAliases([ev({ alias: blank })], memory);
    assert.equal(stamped[0].alias, "Audio");
    assert.equal(memory.get(ID), "Audio");
  }
  assert.equal(nonBlank(""), null);
  assert.equal(nonBlank("  "), null);
  assert.equal(nonBlank(null), null);
});

test("no name known -> null, never the id", () => {
  const stamped = stampEventAliases([ev()], new Map());
  assert.equal(stamped[0].alias, null);
  assert.notEqual(stamped[0].alias, ID);
});

test("decoder: the wire alias lands on the item; a blank one decodes to null", () => {
  const list = decodeShareEvents({
    envelope: {
      events: [
        { share_id: ID, alias: "Audio", kind: "mounted", negotiated_version: "3", at_ms: 5 },
        { share_id: ID, alias: "", kind: "unmounted", at_ms: 6 },
        { share_id: ID, kind: "mount_failed", detail: "x", at_ms: 7 }
      ]
    }
  });
  assert.ok(list !== null);
  assert.deepEqual(
    list!.events.map((e) => e.alias),
    ["Audio", null, null]
  );
});

// ---- the hook and the surface ------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

test("the hook stamps at ingest (seed read and happening), and the configured list teaches", () => {
  const hook = src("features/sources/useNetworkShares.ts");
  assert.ok(/stampEventAliases\(incoming, aliasMemory\.current\)/.test(hook), "ingest stamps");
  assert.ok(/rememberShareAliases\(aliasMemory\.current, state\.shares\)/.test(hook), "configured teaches");
  assert.ok(/if \(ev !== null\) ingestEvents\(ev\.events\);/.test(hook), "happenings go through ingest");
  assert.ok(/if \(!cancelled && r\.ok\) ingestEvents\(r\.value\.events\);/.test(hook), "seed goes through ingest");
  assert.ok(!/setEvents\(ev\.events\)|setEvents\(r\.value\.events\)/.test(hook), "no raw ring reaches state");
});

test("the surface paints ev.alias, else the live lookup, else neutral copy - never the id, never detail", () => {
  const feed = src("features/activity/ShareActivityFeed.tsx");
  assert.ok(/const name = ev\.alias \?\? share\?\.alias \?\? null;/.test(feed));
  assert.ok(/\{name \?\? t\("sources\.activity\.unnamedShare"\)\}/.test(feed));
  assert.ok(!/\?\? ev\.shareId/.test(feed), "share_id is never a name");
  assert.ok(!/ev\.detail/.test(feed) && !/sources-activity-detail/.test(feed), "detail is not painted");
  const en = src("locales/en.ts");
  const m = /"sources\.activity\.unnamedShare":\s*"([^"]*)"/.exec(en);
  assert.ok(m !== null && /^[\x20-\x7E]+$/.test(m![1]) && !/\{/.test(m![1]));
});
