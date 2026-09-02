// Contract tests for the track_detail decoder. Fixtures are the exact
// shapes captured live from the device after the keyless cascade +
// cache-hit refix (2026-07-23): artist_bio ok via Wikipedia with
// attribution + enhancement; album_notes not_found with a hint.

import test from "node:test";
import assert from "node:assert/strict";
import { decodeTrackDetail } from "../../src/features/playback/track-detail-decoders.ts";

const RIG_FIXTURE = {
  v: 1,
  status: "ok",
  target: { scheme: "mpd-path", value: "INTERNAL/U2/x.mp3" },
  sources: {
    artist_bio: {
      status: "ok",
      provider_id: "wikipedia",
      privacy_class: "anonymous",
      attribution: {
        license: "CC BY-SA",
        source_name: "Wikipedia",
        source_url: "https://en.wikipedia.org/wiki/U2"
      },
      enhancement: {
        provider: "lastfm",
        reason: "Add a Last.fm API key for richer editorial bios",
        requires_key: true
      },
      payload: {
        language: "en",
        source_url: "https://en.wikipedia.org/wiki/U2",
        summary: "U2 are an Irish rock band from Dublin.",
        title: "U2"
      }
    },
    album_notes: {
      status: "not_found",
      provider_id: "wikipedia",
      privacy_class: "anonymous",
      attribution: null,
      enhancement: {
        provider: "lastfm",
        reason: "Add a Last.fm API key to try one more source",
        requires_key: true
      }
    },
    lyrics: {
      status: "ok",
      provider_id: "lrclib",
      payload: {
        plain_lyrics: "You say you want...",
        synced_lyrics: "[00:12.00] You say you want...",
        is_synced: true,
        source_url: "https://lrclib.net/lyrics/123"
      }
    },
    artwork: { status: "ok", payload: { url: "/x" } },
    reconciliation: {
      status: "ok",
      payload: {
        canonical: { recording_type: "Compilation", first_release_year: 1998 },
        confidence_percent: 100
      }
    }
  }
};

test("artist_bio decodes text, attribution (CC BY-SA link) and enhancement", () => {
  const d = decodeTrackDetail(RIG_FIXTURE);
  assert.ok(d !== null);
  const b = d!.artistBio;
  assert.equal(b.status, "ok");
  assert.equal(b.providerId, "wikipedia");
  assert.equal(b.privacyClass, "anonymous");
  assert.ok(b.text && b.text.length > 0);
  assert.equal(b.attribution?.license, "CC BY-SA");
  // The CC BY-SA link MUST be present (this is the exact field the
  // cache-hit refix restored).
  assert.equal(b.sourceUrl, "https://en.wikipedia.org/wiki/U2");
  assert.equal(b.enhancement?.provider, "lastfm");
  assert.equal(b.enhancement?.requiresKey, true);
});

test("album_notes not_found still carries an enhancement hint, no attribution", () => {
  const d = decodeTrackDetail(RIG_FIXTURE);
  const n = d!.albumNotes;
  assert.equal(n.status, "not_found");
  assert.equal(n.text, null);
  assert.equal(n.attribution, null);
  assert.equal(n.enhancement?.provider, "lastfm");
});

test("lyrics decode plain + synced + source_url", () => {
  const d = decodeTrackDetail(RIG_FIXTURE);
  assert.equal(d!.lyrics.status, "ok");
  assert.ok(d!.lyrics.plain && d!.lyrics.plain.length > 0);
  assert.equal(d!.lyrics.isSynced, true);
  assert.equal(d!.lyrics.sourceUrl, "https://lrclib.net/lyrics/123");
});

test("reconciliation + artwork still decode", () => {
  const d = decodeTrackDetail(RIG_FIXTURE);
  assert.equal(d!.reconciliation?.recordingType, "Compilation");
  assert.equal(d!.reconciliation?.firstReleaseYear, 1998);
  assert.equal(d!.artwork, "ok");
});

test("attribution without a source_url decodes to null sourceUrl (honest)", () => {
  const d = decodeTrackDetail({
    sources: {
      artist_bio: {
        status: "ok",
        provider_id: "wikipedia",
        privacy_class: "anonymous",
        attribution: { source_name: "Wikipedia", license: "CC BY-SA" },
        payload: { summary: "x" }
      }
    }
  });
  assert.equal(d!.artistBio.attribution?.sourceUrl, null);
  assert.equal(d!.artistBio.sourceUrl, null);
});

test("absent enrichment sources decode to a clean absent shape", () => {
  const d = decodeTrackDetail({ sources: {} });
  assert.ok(d !== null);
  assert.equal(d!.artistBio.status, "absent");
  assert.equal(d!.artistBio.text, null);
  assert.equal(d!.albumNotes.status, "absent");
  assert.equal(d!.lyrics.status, "absent");
  assert.equal(d!.artwork, "absent");
  assert.equal(d!.reconciliation, null);
});

test("decodeTrackDetail returns null only on a shape failure", () => {
  assert.equal(decodeTrackDetail(null), null);
  assert.equal(decodeTrackDetail(42), null);
  assert.equal(decodeTrackDetail({ v: 1 }), null);
});
