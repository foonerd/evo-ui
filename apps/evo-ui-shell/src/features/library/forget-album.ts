// forget-album - the library.forget_album envelope.
//
// The album's identity is the one the album drill already uses: the
// tile's album_id when the browse answer carried one, else the display
// title; and when the title is sent and the tile has an artist, the
// parent artist narrows same-titled albums. No other key - the hook adds
// the envelope version. Forgetting goes through the one forgotten-track
// set: the files, the source and the live queue are untouched.
// Type alias, not interface: dispatch takes Record<string, unknown>,
// and only aliases carry the implicit index signature.

import type { FacetEntry } from "./library-decoders";

export type ForgetAlbumPayload = {
  album: string;
  parent?: { tag: "artist"; value: string };
};

export function forgetAlbumPayload(
  entry: Pick<FacetEntry, "value" | "albumId" | "artist">
): ForgetAlbumPayload {
  if (entry.albumId !== null && entry.albumId.length > 0) {
    return { album: entry.albumId };
  }
  if (entry.artist !== null && entry.artist.length > 0) {
    return { album: entry.value, parent: { tag: "artist", value: entry.artist } };
  }
  return { album: entry.value };
}

/** The album list without one album: matched by album_id when both
 *  sides carry one, else by display title plus artist, so a same-titled
 *  album by another artist stays. Pure; the surface applies it to the
 *  album cache and, when that list is on screen, to the painted list. */
export function withoutAlbum<T extends Pick<FacetEntry, "value" | "albumId" | "artist">>(
  entries: readonly T[],
  album: Pick<FacetEntry, "value" | "albumId" | "artist">
): T[] {
  const same = (e: T): boolean =>
    e.albumId !== null && album.albumId !== null
      ? e.albumId === album.albumId
      : e.value === album.value && e.artist === album.artist;
  return entries.filter((e) => !same(e));
}
