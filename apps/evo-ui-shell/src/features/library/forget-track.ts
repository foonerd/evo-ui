// forget-track - the library.forget_track envelope.
//
// One key: the file's uri, as the browse entry carries it. The hook
// adds the envelope version. Forgetting takes the track out of the
// library the operator browses; the file, the source and the live
// queue are untouched, so there is no source_id, no path, nothing to
// delete. Type alias, not interface: dispatch takes Record<string,
// unknown>, and only aliases carry the implicit index signature.

export type ForgetTrackPayload = {
  uri: string;
};

export function forgetTrackPayload(uri: string): ForgetTrackPayload {
  return { uri };
}
