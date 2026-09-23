// playlist-payloads - the audio.playlist add / remove / move envelopes,
// field for field as the plugin's payload structs read them
// (AddToPlaylistPayload { name, uris }, RemoveFromPlaylistPayload
// { name, positions }, MoveInPlaylistPayload { name, from_position,
// to_position }). A missing field is a Permanent parse refusal on the
// wire, so the key names are the whole contract. dispatchVoid adds the
// envelope version. Pure; the contract harness encodes each one.
//
// Type aliases, not interfaces: dispatchVoid takes Record<string,
// unknown>, and only aliases carry the implicit index signature.

export type AddToPlaylistPayload = {
  name: string;
  uris: string[];
};

export type RemoveFromPlaylistPayload = {
  name: string;
  /** Zero-based positions; the surfaces remove one at a time. */
  positions: number[];
};

export type MoveInPlaylistPayload = {
  name: string;
  from_position: number;
  to_position: number;
};

export function addToPlaylistPayload(
  name: string,
  uris: readonly string[]
): AddToPlaylistPayload {
  return { name, uris: [...uris] };
}

export function removeFromPlaylistPayload(
  name: string,
  position: number
): RemoveFromPlaylistPayload {
  return { name, positions: [position] };
}

export function moveInPlaylistPayload(
  name: string,
  fromPosition: number,
  toPosition: number
): MoveInPlaylistPayload {
  return { name, from_position: fromPosition, to_position: toPosition };
}
