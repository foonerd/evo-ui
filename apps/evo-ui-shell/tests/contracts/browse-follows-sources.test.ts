// Contract: the folder browse follows a sources republish.
//
// Field failure: LibrarySurface fetched a folder listing on mode /
// source change and on the explicit refresh only. Nothing was keyed to
// the audio_library_sources republish that useLibrary already applies,
// so when MPD pruned a yanked stick's tree (or a Remove / scrub emptied
// the browsed path) the grid kept the last listing until a reload. Now
// the browsed source's row is watched through the signal the hook
// already carries: a republish that changes THAT row (state, counts,
// mount) refetches the path the operator is looking at and, when that
// path no longer answers, walks up crumb by crumb to the first path
// that does, ending at the source root; a republish that drops the
// source falls back to the non-removable local source's root; a
// republish for an unrelated source changes nothing. No second socket
// ask, no refresh as the truth path. Rescan's verb, tracksOfTotal,
// scanProgressLine and Force eject are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  browseFollow,
  selectedStoreOrFloor,
  browseRefusalIsMissingStore,
  sourceRowSignature,
  walkUpPaths,
  FALLBACK_SOURCE_ID
} from "../../src/features/library/browse-follow.ts";
import type { SourceRecord } from "../../src/features/library/library-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const surface = src("features/library/LibrarySurface.tsx");
const hook = src("features/library/useLibrary.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const usb = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  id: "usb-stick-1",
  displayName: "Stick",
  kind: "local_usb",
  mountPath: "/mnt/usb/stick",
  probeCadenceMs: 0,
  state: "online",
  trackCount: 120,
  trackCountAvailable: 120,
  ...over
});
const internal: SourceRecord = {
  id: "local-internal",
  displayName: "Internal",
  kind: "local_internal",
  mountPath: "/var/lib/evo/music",
  probeCadenceMs: 0,
  state: "online",
  trackCount: 900,
  trackCountAvailable: 900
};

const followBlock = between(surface, "// Follow a sources republish for the browsed source", "const onPlaylistEntry = useCallback");

const both = ["local-internal", "usb-stick-1"];

test("browsing local-internal at USB/Audio: the republish that drops the USB source id refetches, and the walk tries USB/Audio, USB, then the root", () => {
  // The owner field: Local library selected, path USB/Audio, the stick
  // yanked. The USB source leaves the republish and MPD prunes the tree
  // under Internal - but Internal's own row (kind / state / mount /
  // counts) often does not move on that republish.
  const before = { id: "local-internal", sig: sourceRowSignature(internal), ids: both };
  const after = { id: "local-internal", sig: sourceRowSignature(internal), ids: ["local-internal"] };
  assert.equal(before.sig, after.sig, "Internal's signature is unchanged");
  assert.equal(browseFollow(before, after), "refetch", "a dropped source id is a refetch of the current path");
  assert.deepEqual(walkUpPaths("USB/Audio", ["USB", "USB/Audio"]), ["USB/Audio", "USB", ""]);
  // The selected id itself missing is still the fallback, not a walk.
  assert.equal(
    browseFollow({ id: "usb-stick-1", sig: sourceRowSignature(usb()), ids: both }, { id: "usb-stick-1", sig: null, ids: ["local-internal"] }),
    "source-gone"
  );
  // A source that joins the republish prunes nothing: hold.
  assert.equal(browseFollow(after, before), "hold");
  // An unrelated count or display-name change on another source: hold.
  assert.equal(browseFollow(before, { ...before, ids: [...both] }), "hold");
  // The surface carries the id set from the same list the hook keeps.
  assert.ok(/ids: sources\.map\(\(s\) => s\.id\)/.test(surface), "the id set comes from the sources list, no second ask");
});

test("a sources republish dropping or emptying the browsed USB path does not leave the last folder grid on screen", () => {
  const before = { id: "usb-stick-1", sig: sourceRowSignature(usb()), ids: both };
  // The stick's tree was pruned: the counts settle to nothing.
  assert.equal(
    browseFollow(before, { id: "usb-stick-1", sig: sourceRowSignature(usb({ trackCount: 0, trackCountAvailable: 0 })), ids: both }),
    "refetch"
  );
  // The stick went offline: the plugin serves its cache marked stale.
  assert.equal(browseFollow(before, { id: "usb-stick-1", sig: sourceRowSignature(usb({ state: "offline" })), ids: both }), "refetch");
  // The stick was remounted somewhere else.
  assert.equal(browseFollow(before, { id: "usb-stick-1", sig: sourceRowSignature(usb({ mountPath: "/mnt/usb/other" })), ids: both }), "refetch");
  // Remove / yank: the row is gone from the republish.
  assert.equal(browseFollow(before, { id: "usb-stick-1", sig: null, ids: both }), "source-gone");
  assert.equal(FALLBACK_SOURCE_ID, "local-internal", "the non-removable floor source");
  // The walk-up: the path first, then each crumb up, then the root, once each.
  assert.deepEqual(walkUpPaths("USB/Audio", ["USB", "USB/Audio"]), ["USB/Audio", "USB", ""]);
  assert.deepEqual(walkUpPaths("", []), [""], "the root has nowhere to walk");
  // DLNA: the trail is opaque object ids, never split on "/".
  assert.deepEqual(walkUpPaths("obj-22", ["obj-1", "obj-22"]), ["obj-22", "obj-1", ""]);
  assert.deepEqual(walkUpPaths("a/b", ["a", "a/b", "a/b/c"]), ["a/b", "a", ""], "crumbs below the current path are not candidates");

  // The surface: a refetch walks the candidates on the existing browse
  // verb, paints the first that answers, and on none answering paints
  // the honest error - never the last listing.
  assert.ok(/const follow = browseFollow\(prev, next\);/.test(followBlock));
  assert.ok(
    /if \(follow === "source-gone"\) \{\s*followRunRef\.current \+= 1;\s*setSelectedSource\(FALLBACK_SOURCE_ID\);/.test(followBlock),
    "a dropped source retires any walk in flight and falls back to the floor source"
  );
  assert.ok(/if \(prev !== undefined && prev\.id !== next\.id\) \{[\s\S]*?followRunRef\.current \+= 1;/.test(followBlock), "a source switch retires any walk in flight");
  assert.ok(/if \(run !== followRunRef\.current\) return;/.test(followBlock), "a retired walk never paints");
  assert.ok(/for \(const path of walkUpPaths\(/.test(followBlock), "the walk-up");
  assert.ok(/const r = await browse\(sourceId, path\);/.test(followBlock), "the same browse verb, no second socket ask");
  assert.ok(/if \(r\.ok\) \{[\s\S]*?setBrowseState\(r\.value\);[\s\S]*?return;/.test(followBlock), "the first path that answers paints");
  assert.ok(/setBrowseState\(null\);\s*setBrowseError\(\{ message: last, timeout: isTimeoutMessage\(last\) \}\);/.test(followBlock),
    "none answering paints the error, not the last grid");
  assert.ok(/setDlnaTrail\(/.test(followBlock), "a DLNA walk-up truncates the trail to the crumb that answered");
});

test("a republish for an unrelated source does not refetch this browse", () => {
  const before = { id: "usb-stick-1", sig: sourceRowSignature(usb()), ids: both };
  // Another source changed; this row came back byte-identical.
  assert.equal(browseFollow(before, { id: "usb-stick-1", sig: sourceRowSignature(usb()), ids: both }), "hold");
  // A display-name edit does not change the listing.
  assert.equal(browseFollow(before, { id: "usb-stick-1", sig: sourceRowSignature(usb({ displayName: "Music stick" })), ids: both }), "hold");
  // The first observation after mount: the mount browse already ran.
  assert.equal(browseFollow(undefined, { id: "usb-stick-1", sig: sourceRowSignature(usb()), ids: both }), "hold");
  // A source switch is the source-change effect's browse, not a follow.
  assert.equal(browseFollow(before, { id: "local-internal", sig: sourceRowSignature(internal), ids: both }), "hold");
  // A source that never existed stays nothing.
  assert.equal(browseFollow({ id: "x", sig: null, ids: both }, { id: "x", sig: null, ids: both }), "hold");
  assert.equal(sourceRowSignature(undefined), null);

  // The surface keys on the signal useLibrary already applies - the
  // sources list - and nothing else; a hold returns before any browse.
  assert.ok(
    /const browsedNow = useMemo<BrowsedSource \| undefined>\(\s*\(\) =>\s*sources === null\s*\? undefined\s*: \{ id: selectedSource, sig: sourceRowSignature\(selected\), ids: sources\.map\(\(s\) => s\.id\) \},/.test(surface)
  );
  assert.ok(/if \(follow === "hold"\) return;/.test(followBlock));
  assert.ok(/if \(browseMode !== "folder"\) return;/.test(followBlock), "facet modes are not this row");
  assert.ok(!/subscribe\(|onHappening\(|new WsTransport|list_sources/.test(followBlock), "no second socket ask");
  assert.ok(/\}, \[browsedNow\]\);/.test(followBlock), "keyed on the browsed row, nothing else");
  assert.ok(/if \(decoded !== null\) \{\s*setSources\(decoded\.sources\);\s*return;/.test(hook), "the hook still applies every republish as before");
});

test("a gone store is the floor, not a Bad Request", () => {
  // USB yank, NFS Remove, SMB Remove, any remote: returning to
  // Browse still holding that source id must not call the verb.
  assert.equal(selectedStoreOrFloor(["local-internal"], "nas-x"), FALLBACK_SOURCE_ID);
  assert.equal(selectedStoreOrFloor(["local-internal", "nas-x"], "nas-x"), "nas-x");
  assert.equal(selectedStoreOrFloor(null, "nas-x"), "nas-x");
  assert.equal(selectedStoreOrFloor(["local-internal"], "usb-stick-1"), FALLBACK_SOURCE_ID);
  const floor = between(surface, "// Floor a gone store when the sources list moves.", "// Fetch on mode / source change.");
  assert.ok(/selectedStoreOrFloor\(/.test(floor), "the floor helper runs on the sources list, not on the root fetch");
  assert.ok(/if \(next !== selectedSource\) \{\s*setSelectedSource\(next\);/.test(floor));
  assert.ok(!/browseSource\(/.test(floor), "flooring does not browse");
  assert.equal(browseRefusalIsMissingStore("refused: 400 Bad Request"), true);
  assert.equal(browseRefusalIsMissingStore("unknown_source"), true);
  assert.equal(browseRefusalIsMissingStore("timeout"), false);
  const browseSource = between(surface, "const browseSource = useCallback", "const loadMoreBrowse");
  assert.ok(
    /browseRefusalIsMissingStore\(r\.message\)/.test(browseSource),
    "a 400 browse of a gone store floors; it does not toast the refuse"
  );
  assert.ok(
    /setSelectedSource\(FALLBACK_SOURCE_ID\)/.test(browseSource),
    "the gone-store refuse walks to the floor"
  );
});

test("LOCAL / USB / DLNA browse still works: navigation, crumbs and the source-change browse are unchanged", () => {
  const sourceChange = between(surface, "// Fetch on mode / source change.", "// Drill a facet value");
  assert.ok(/if \(browseMode === "folder"\) \{\s*setFacetState\(null\);\s*setDrill\(null\);\s*setDrillTracks\(null\);\s*void browseSource\(selectedSource, ""\);/.test(sourceChange));
  // Authority 2026-09-21: the pin that required `sources` on this
  // effect encoded the invert. A library-sources republish (NAS
  // index heartbeat after overlay remount) re-fetched the root and
  // popped DLNA off By Album / All Artists back to Video / Music /
  // Photos, then stacked the breadcrumb. The list arriving is the
  // gate; a later republish is browseFollow's signal.
  assert.ok(/const sourcesMissing = sources === null;/.test(sourceChange));
  assert.ok(/\}, \[browseMode, selectedSource, browseSource, loadFacet, sourcesMissing\]\);/.test(sourceChange));
  assert.ok(!/browseSource\(selectedSource, ""\)[\s\S]*\}, \[browseMode, selectedSource, browseSource, loadFacet, sources\]\);/.test(sourceChange),
    "a sources republish must not re-root the folder browse");
  assert.ok(/const onNavigateEntry = useCallback\([\s\S]*?void browseSource\(selectedSource, entry\.uri\);/.test(surface));
  assert.ok(/const onCrumbNavigate = useCallback\([\s\S]*?void browseSource\(selectedSource, path\);/.test(surface));
  assert.ok(/const isDlnaSource = selected\?\.kind === "network_dlna";/.test(surface));
  const verb = between(hook, "const browse = useCallback", "const browseByDimension");
  assert.ok(/"library\.browse_library"/.test(verb) && /source_id: sourceId,\s*path/.test(verb), "the browse verb is the same");
  const refresh = between(surface, "const onRefresh = useCallback", "// The library browse is a file-tree walker");
  assert.ok(/void browseSource\(selectedSource, browseState\?\.path \?\? ""\);/.test(refresh), "the explicit refresh is untouched");
});

test("a DLNA drill stays put: timeout is not a walk to Video / Music / Photos, and a stale root fetch cannot paint", () => {
  assert.ok(/if \(isTimeoutMessage\(r\.message\)\) \{\s*setBrowseError\(\{ message: r\.message, timeout: true \}\);\s*setFeedback\(r\.message\);\s*return;/.test(followBlock),
    "a SOAP / deadline miss stops the walk; it does not climb to root");
  const browseSource = between(surface, "const browseSource = useCallback", "const loadMoreBrowse");
  assert.ok(/const gen = \+\+browseGenRef\.current;/.test(browseSource), "each browse ask is generation-tagged");
  assert.ok(/if \(gen !== browseGenRef\.current\) return;/.test(browseSource), "a stale browse never paints");
  assert.ok(/followRunRef\.current \+= 1;/.test(browseSource), "a navigation retires a follow walk in flight");
  assert.ok(/browseGenRef\.current \+= 1;/.test(followBlock), "a follow walk retires a browse in flight");
});

test("must not move: Rescan's verb and wiring, tracksOfTotal, scanProgressLine, Force eject", () => {
  const rescan = between(surface, "const onUpdateSource = useCallback", "const [removeTarget, setRemoveTarget]");
  assert.ok(/const r = await library\.updateSource\(source\.id\);/.test(rescan));
  assert.ok(!/browse/.test(rescan), "Rescan does not browse");
  assert.ok(/onClick=\{\(\) => onUpdateSource\(source\)\}/.test(surface));
  assert.ok(/scanProgressLine\(library\.scanProgress\[source\.id\]\)/.test(surface));
  assert.ok(/t\("library\.tracksOfTotal", \{\s*available:\s*source\.trackCountAvailable\.toLocaleString\(\),\s*total: source\.trackCount\.toLocaleString\(\)\s*\}\)/.test(surface));
  const line = src("features/library/scan-progress-line.ts");
  assert.ok(/if \(entry === undefined \|\| entry\.phase !== "scanning"\) return null;/.test(line));
  const eject = src("features/sources/UsbDrivesSurface.tsx");
  assert.ok(/if \(ctx === "saferemove"\) \{\s*setModal\(\{ kind: "force", drive, holders: r\.data\.holders \}\);/.test(eject), "Force eject is the Safe Remove refuse");
});
