// playlist-export - the playlist.export_file envelope and the decoder
// for its answer.
//
// The glass sends the playlist name and nothing else, so the plugin's
// default format (.m3u) applies; it never sends `format`, `absolute` or
// any device path. The answer is the file as text with a name to save
// it under; the surface offers that as a browser download. A cue answer
// is refused: a cue sheet describes one audio file's tracks, which is
// not what a playlist is, and the plugin does not produce one.
//
// Type alias, not interface: the hook spreads it into the versioned
// envelope, and only aliases carry the implicit index signature.

export type ExportFormat = "m3u" | "pls";

export type ExportFilePayload = {
  name: string;
};

export function exportFilePayload(name: string): ExportFilePayload {
  return { name };
}

export interface ExportReport {
  name: string;
  format: ExportFormat;
  /** `<name>.<ext>` as the plugin named it; the download's file name. */
  filename: string;
  entries: number;
  /** The file's text. */
  content: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Decode the verb's answer, or null when it is not a usable report:
 *  a format other than m3u / pls (a cue sheet included), or a missing
 *  filename or content, is nothing the glass can offer. */
export function decodeExportReport(raw: unknown): ExportReport | null {
  if (!isObject(raw)) return null;
  const format = raw["format"];
  if (format !== "m3u" && format !== "pls") return null;
  const name = raw["name"];
  const filename = raw["filename"];
  const content = raw["content"];
  if (typeof name !== "string" || typeof filename !== "string" || filename.length === 0) return null;
  if (typeof content !== "string") return null;
  const entriesRaw = raw["entries"];
  const entries = typeof entriesRaw === "number" && Number.isFinite(entriesRaw) ? entriesRaw : 0;
  return { name, format, filename, entries, content };
}
