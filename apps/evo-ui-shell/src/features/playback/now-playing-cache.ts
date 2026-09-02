// Last-known now_playing snapshot for appliance hard-refresh.
//
// On F5 the track is often still playing on the device. Painting
// last-known immediately (then reconciling via get_now_playing) is
// exact-or-degraded without pretending the backend restarted.

import {
  decodeNowPlaying,
  type NowPlaying
} from "./now-playing-decoders";

const STORAGE_KEY = "evo.playback.last_now_playing_v1";

export function readLastNowPlaying(): NowPlaying | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) return null;
    return decodeNowPlaying(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeLastNowPlaying(state: NowPlaying): void {
  if (typeof window === "undefined") return;
  try {
    // Persist the wire-shaped fields the decoder understands by
    // re-encoding from the live UI model.
    const wire = {
      transport_state: state.transportState,
      elapsed_ms: state.elapsedMs,
      duration_ms: state.durationMs,
      volume: state.volume,
      muted: state.muted,
      repeat: state.repeat,
      shuffle: state.shuffle,
      single: state.single,
      consume: state.consume,
      track:
        state.track === null
          ? null
          : {
              title: state.track.title,
              artist: state.track.artist,
              album: state.track.album,
              mpd_path: state.track.mpdPath,
              artwork_url: state.track.artworkUrl,
              composer: state.track.classical?.composer ?? null,
              composer_sort: state.track.classical?.composerSort ?? null,
              conductor: state.track.classical?.conductor ?? null,
              ensemble: state.track.classical?.ensemble ?? null,
              performer: state.track.classical?.performer ?? null,
              work: state.track.classical?.work ?? null,
              work_sort: state.track.classical?.workSort ?? null,
              movement: state.track.classical?.movement ?? null,
              movement_number: state.track.classical?.movementNumber ?? null,
              original_date: state.track.classical?.originalDate ?? null,
              recording_date: state.track.classical?.recordingDate ?? null,
              label: state.track.classical?.label ?? null,
              medium: state.track.classical?.medium ?? null
            }
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(wire));
  } catch {
    // Quota / private mode — ignore; live seed still works.
  }
}
