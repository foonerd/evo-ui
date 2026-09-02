// Provenance formatting for the now-playing source format - the codec
// badge and the rate/bit-depth/bitrate detail line. Per the compact
// model the codec badge + provenance live on the art canvas (the
// swipe-left reveal), not on the control surface. Kept pure so it is
// shared between the canvas and any other consumer, and unit-testable.

import type { AudioFormat } from "../audio/stream-format-decoders";
import type { StreamFormat } from "../audio/stream-format-decoders";

/** The codec family badge for the canvas: "DSD" for DSD-encoded
 *  content (the container codec dsf/dff is not what the listener
 *  cares about), otherwise the uppercased source codec (FLAC / MP3 /
 *  WAV / ...). null when the wire has no codec yet. */
export function codecBadge(sf: StreamFormat | null): string | null {
  if (sf === null) return null;
  if (sf.source?.kind === "dsd") return "DSD";
  const codec = sf.sourceCodec ?? sf.source?.kind ?? null;
  if (codec === null || codec === "") return null;
  return codec.toUpperCase();
}

/** Compact one-line "44.1 kHz / 16-bit" (or DSD / bitrate forms)
 *  detail for the canvas. Mirrors the kiosk-tight form. */
export function formatSourceShort(f: AudioFormat): string {
  const rateLabel = (rateHz: number): string => {
    const khz = rateHz / 1000;
    const text = Number.isInteger(khz) ? String(khz) : khz.toFixed(1);
    return `${text} kHz`;
  };
  if (f.kind === "pcm") {
    const depth =
      f.codec === "pcm_s16_le"
        ? "16-bit"
        : f.codec === "pcm_s24_le"
          ? "24-bit"
          : f.codec === "pcm_s32_le"
            ? "32-bit"
            : f.codec === "pcm_f32"
              ? "32-bit float"
              : f.codec;
    return `${rateLabel(f.rateHz)} / ${depth}`;
  }
  if (f.kind === "dsd") {
    const mhz: Record<string, string> = {
      DSD64: "2.82 MHz",
      DSD128: "5.64 MHz",
      DSD256: "11.29 MHz",
      DSD512: "22.58 MHz",
      DSD1024: "45.16 MHz"
    };
    const derived = mhz[f.rate];
    return derived !== undefined ? `${derived} / 1 bit` : `${f.rate} / 1 bit`;
  }
  if (f.bitrate === null) {
    return `${rateLabel(f.rateHz)}`;
  }
  if (f.bitrate.kind === "cbr") {
    return `${rateLabel(f.rateHz)} / ${f.bitrate.kbps} kbps`;
  }
  if (f.bitrate.kind === "vbr") {
    return `${rateLabel(f.rateHz)} / ${f.bitrate.avgKbps} kbps VBR`;
  }
  return `${rateLabel(f.rateHz)} / VBR`;
}

/** The detail line for the canvas: prefer source format, fall back to
 *  effective (post-conversion). null when neither is known. */
export function provenanceDetail(sf: StreamFormat | null): string | null {
  if (sf === null) return null;
  const fmt = sf.source ?? sf.effective;
  return fmt ? formatSourceShort(fmt) : null;
}
