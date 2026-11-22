// playlist-import - the playlist.import_file envelope and the two pure
// readings the import control makes of a picked file's name.
//
// The glass reads the file itself and sends its text inline, so the
// payload is { name, format, content } and nothing else: no `path` (that
// is the device-upload shape), no `base`, no `overwrite`. The plugin
// cannot read a format off inline content, so the glass always names it,
// from the file's extension: .m3u and .m3u8 are m3u; .pls; .cue. Any
// other extension is refused on the glass before a write.
//
// Type alias, not interface: dispatchVoid takes Record<string, unknown>,
// and only aliases carry the implicit index signature.

export type ImportFormat = "m3u" | "pls" | "cue";

export type ImportFilePayload = {
  name: string;
  format: ImportFormat;
  content: string;
};

export function importFilePayload(
  name: string,
  format: ImportFormat,
  content: string
): ImportFilePayload {
  return { name, format, content };
}

/** The format a file name's extension says, or null when it says none
 *  of the three. Case-insensitive; a bare "m3u" with no dot is a name,
 *  not an extension. */
export function importFormatFromFileName(fileName: string): ImportFormat | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (ext === "m3u" || ext === "m3u8") return "m3u";
  if (ext === "pls") return "pls";
  if (ext === "cue") return "cue";
  return null;
}

/** The stored playlist's name: the file name without its last
 *  extension. Inner dots stay - "set.2024.pls" is "set.2024". */
export function playlistNameFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}
