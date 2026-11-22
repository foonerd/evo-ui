// offer-download - hand text to the browser as a file download.
//
// This is the operator's browser saving a file on the operator's
// machine: an object URL offered through an anchor, then revoked.
// Nothing is sent anywhere and nothing is written on the device.

export function offerDownload(filename: string, content: string, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The media type a playlist file is offered as. */
export function playlistMime(format: "m3u" | "pls"): string {
  return format === "pls" ? "audio/x-scpls" : "audio/x-mpegurl";
}
