// Shuffle is off, by track, by album, or similar. The control shows the
// mode the player reports and cycles it with one write (set_shuffle
// { mode }).
//
// now_playing.shuffle is MPD's random flag, not the mode: random true can
// only mean track shuffle; random false is off, album OR similar shuffle,
// because those orders are written into the queue and MPD plays it in
// order. So the painted mode is the reported shuffle_mode, and without it
// the glass paints by-track from random true and nothing from random false
// - it does not guess between off, albums and similar.

import type { NowPlaying, ShuffleMode } from "./now-playing-decoders.ts";

export const SHUFFLE_MODES: ReadonlyArray<ShuffleMode> = ["off", "tracks", "albums", "similar"];

export function paintedShuffleMode(nowPlaying: NowPlaying | null): ShuffleMode | null {
  if (nowPlaying === null) return null;
  if (nowPlaying.shuffleMode !== null) return nowPlaying.shuffleMode;
  return nowPlaying.shuffle ? "tracks" : null;
}

/** The mode one press moves to: off -> tracks -> albums -> similar -> off. From an
 *  unreported mode the first press asks for track shuffle - a choice the
 *  operator made, not a guess about where the player is. */
export function nextShuffleMode(current: ShuffleMode | null): ShuffleMode {
  if (current === null) return "tracks";
  const i = SHUFFLE_MODES.indexOf(current);
  return SHUFFLE_MODES[(i + 1) % SHUFFLE_MODES.length];
}
