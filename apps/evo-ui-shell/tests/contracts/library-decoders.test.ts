// Contract tests for the audio.library decoders. Wire shapes
// captured live on the rig against the deployed binary.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeBrowseLibrary,
  decodeLibraryEntry,
  decodeListSources,
  decodeListSourcesHappening,
  decodeProbeSource,
  decodeSourceRecord,
  decodeUpdateSource,
  formatSourceKind,
  formatSourceState,
  isRemovable
} from "../../src/features/library/library-decoders.ts";

// --- decodeSourceRecord ------------------------------------------

test("decodeSourceRecord decodes the local-internal floor source", () => {
  const s = decodeSourceRecord({
    display_name: "Local library",
    id: "local-internal",
    kind: { kind: "local_internal" },
    mount_path: "/var/lib/evo/music",
    probe_cadence_ms: 60000,
    scan_policy: {
      kind: "eager_incremental",
      on_mount_event: false,
      on_online: true
    },
    state: { kind: "probing" },
    track_count: 12847,
    track_count_available: 12847
  });
  assert.equal(s?.id, "local-internal");
  assert.equal(s?.displayName, "Local library");
  assert.equal(s?.kind, "local_internal");
  assert.equal(s?.mountPath, "/var/lib/evo/music");
  assert.equal(s?.state, "probing");
  assert.equal(s?.trackCount, 12847);
});

test("decodeSourceRecord decodes a USB source", () => {
  const s = decodeSourceRecord({
    display_name: "USB drive (8GB)",
    id: "usb-sda1",
    kind: { kind: "local_usb", device: "/dev/sda1" },
    mount_path: "/media/usb-sda1",
    probe_cadence_ms: 30000,
    state: { kind: "online" },
    track_count: 247,
    track_count_available: 247
  });
  assert.equal(s?.kind, "local_usb");
  assert.equal(s?.state, "online");
});

test("decodeSourceRecord decodes an offline NAS source", () => {
  const s = decodeSourceRecord({
    display_name: "NAS",
    id: "nas-livingroom",
    kind: { kind: "network_nas_smb" },
    mount_path: "smb://nas.example/music",
    state: { kind: "offline", reason: "timeout" },
    track_count: 5000,
    track_count_available: 0
  });
  assert.equal(s?.state, "offline");
  assert.equal(s?.kind, "network_nas_smb");
});

test("decodeSourceRecord maps unknown kind / state tokens to 'other'", () => {
  const s = decodeSourceRecord({
    id: "x",
    display_name: "X",
    kind: { kind: "newfangled_storage" },
    state: { kind: "rebuilding" }
  });
  assert.equal(s?.kind, "other");
  assert.equal(s?.state, "other");
});

test("decodeSourceRecord rejects missing id / display_name", () => {
  assert.equal(decodeSourceRecord({ display_name: "x" }), null);
  assert.equal(decodeSourceRecord({ id: "x" }), null);
  assert.equal(decodeSourceRecord(null), null);
});

// --- decodeListSources -------------------------------------------

test("decodeListSources decodes a populated list", () => {
  const r = decodeListSources({
    v: 1,
    total: 2,
    sources: [
      {
        id: "local-internal",
        display_name: "Local library",
        kind: { kind: "local_internal" },
        state: { kind: "online" }
      },
      {
        id: "usb-sda1",
        display_name: "USB",
        kind: { kind: "local_usb" },
        state: { kind: "online" }
      }
    ]
  });
  assert.equal(r?.sources.length, 2);
  assert.equal(r?.total, 2);
});

test("decodeListSources decodes an empty list", () => {
  const r = decodeListSources({ v: 1, sources: [], total: 0 });
  assert.equal(r?.sources.length, 0);
  assert.equal(r?.total, 0);
});

test("decodeListSources drops bad rows without failing the envelope", () => {
  const r = decodeListSources({
    v: 1,
    total: 2,
    sources: [
      { id: "ok", display_name: "OK", kind: { kind: "local_internal" } },
      { display_name: "Bad - no id" },
      "garbled string"
    ]
  });
  assert.equal(r?.sources.length, 1);
  assert.equal(r?.total, 2);
});

// --- decodeListSourcesHappening ----------------------------------

test("decodeListSourcesHappening decodes the subject_state_changed for audio_library_sources", () => {
  const r = decodeListSourcesHappening({
    type: "subject_state_changed",
    subject_type: "audio_library_sources",
    canonical_id: "evo.audio.library:sources",
    new_state: { v: 1, sources: [], total: 0 }
  });
  assert.equal(r?.sources.length, 0);
});

test("decodeListSourcesHappening ignores other subjects", () => {
  assert.equal(
    decodeListSourcesHappening({
      type: "subject_state_changed",
      subject_type: "audio_playback_now_playing",
      new_state: {}
    }),
    null
  );
});

// --- decodeBrowseLibrary -----------------------------------------

test("decodeBrowseLibrary decodes a root listing with mixed entry kinds", () => {
  const r = decodeBrowseLibrary({
    v: 1,
    source_id: "local-internal",
    path: "",
    entries: [
      { kind: "directory", name: "INTERNAL", uri: "INTERNAL" },
      { kind: "playlist", name: "__favourites__", uri: "__favourites__" },
      { kind: "playlist", name: "Artist A", uri: "Artist A" }
    ],
    source_state: { kind: "probing" },
    stale: false
  });
  assert.equal(r?.sourceId, "local-internal");
  assert.equal(r?.entries.length, 3);
  assert.equal(r?.entries[0].kind, "directory");
  assert.equal(r?.entries[1].kind, "playlist");
  assert.equal(r?.sourceState, "probing");
  assert.equal(r?.stale, false);
});

test("decodeBrowseLibrary surfaces the stale flag for offline sources", () => {
  const r = decodeBrowseLibrary({
    v: 1,
    source_id: "nas-livingroom",
    path: "MusicArchive",
    entries: [
      { kind: "directory", name: "Classical", uri: "MusicArchive/Classical" }
    ],
    source_state: { kind: "offline" },
    stale: true
  });
  assert.equal(r?.stale, true);
  assert.equal(r?.sourceState, "offline");
  assert.equal(r?.path, "MusicArchive");
});

test("decodeLibraryEntry rejects unknown entry kinds", () => {
  assert.equal(
    decodeLibraryEntry({ kind: "symlink", name: "x", uri: "y" }),
    null
  );
  assert.equal(decodeLibraryEntry({ kind: "directory" }), null);
});

test("decodeLibraryEntry keeps title / artist / album / artwork_url for a file entry", () => {
  // Wire shape captured live on the rig (browse_library file entry).
  const e = decodeLibraryEntry({
    kind: "file",
    name: "01 - Embedded Art.m4a",
    uri: "INTERNAL/Sample/01 - Embedded Art.m4a",
    title: "Embedded Art Track",
    artist: "EVO Test Bench",
    album: "EVO Sample AAC (M4A)",
    artwork_url: "/api/v1/audio/artwork?scheme=mpd-album&value=EVO%20Test%20Bench%7CEVO%20Sample%20AAC",
    available: true
  });
  assert.equal(e?.title, "Embedded Art Track");
  assert.equal(e?.artist, "EVO Test Bench");
  assert.equal(e?.album, "EVO Sample AAC (M4A)");
  assert.equal(
    e?.artworkUrl,
    "/api/v1/audio/artwork?scheme=mpd-album&value=EVO%20Test%20Bench%7CEVO%20Sample%20AAC"
  );
  // name (filename) stays available as the fallback for untagged files.
  assert.equal(e?.name, "01 - Embedded Art.m4a");
});

test("decodeLibraryEntry leaves title / artist / album / artwork_url null for a directory", () => {
  const d = decodeLibraryEntry({
    kind: "directory",
    name: "INTERNAL",
    uri: "INTERNAL"
  });
  assert.equal(d?.title, null);
  assert.equal(d?.artist, null);
  assert.equal(d?.album, null);
  assert.equal(d?.artworkUrl, null);
});

// --- decodeProbeSource -------------------------------------------

test("decodeProbeSource decodes the live response from the rig", () => {
  const r = decodeProbeSource({
    v: 1,
    source_id: "local-internal",
    state: { kind: "online" },
    probed_at_ms: 1780508566594,
    probe_duration_ms: 0
  });
  assert.equal(r?.sourceId, "local-internal");
  assert.equal(r?.state, "online");
  assert.equal(r?.probedAtMs, 1780508566594);
});

// --- decodeUpdateSource ------------------------------------------

test("decodeUpdateSource decodes scan_started + job_id", () => {
  const r = decodeUpdateSource({ scan_started: true, job_id: 42 });
  assert.equal(r?.scanStarted, true);
  assert.equal(r?.jobId, 42);
});

test("decodeUpdateSource handles refused (scan_started:false)", () => {
  const r = decodeUpdateSource({ scan_started: false });
  assert.equal(r?.scanStarted, false);
  assert.equal(r?.jobId, null);
});

// --- helpers -----------------------------------------------------

test("formatSourceKind renders human-readable labels", () => {
  assert.equal(formatSourceKind("local_internal"), "Local");
  assert.equal(formatSourceKind("local_usb"), "USB");
  assert.equal(formatSourceKind("network_nas_smb"), "SMB");
  assert.equal(formatSourceKind("network_dlna"), "Media server");
  assert.equal(formatSourceKind("cloud_gdrive"), "Google Drive");
  assert.equal(formatSourceKind("other"), "Source");
});

test("formatSourceState renders human-readable labels", () => {
  assert.equal(formatSourceState("online"), "Online");
  assert.equal(formatSourceState("probing"), "Probing");
  assert.equal(formatSourceState("offline"), "Offline");
  assert.equal(formatSourceState("degraded"), "Degraded");
});

test("isRemovable refuses local_internal and accepts every other kind", () => {
  assert.equal(isRemovable("local_internal"), false);
  assert.equal(isRemovable("local_usb"), true);
  assert.equal(isRemovable("network_nas_smb"), true);
  assert.equal(isRemovable("cloud_gdrive"), true);
});
