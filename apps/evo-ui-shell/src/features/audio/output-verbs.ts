// output-verbs - the five per-output verbs on the audio.delivery shelf,
// their payloads, and the decoder for the answer they share.
//
// Each verb names one of the hw:N,M rows delivery.list_outputs already
// names: { output_id } and nothing else; the volume verb adds `volume`,
// a whole number 0 through 100, and the glass refuses anything else
// before a send. Each answers with that output's state - enabled,
// playing, last-set volume - and the glass paints that output only.
//
// Play is not options.set_output_device (the picker), and this volume is
// not the global volume: neither verb is named here.

export const OUTPUT_VERBS = {
  enable: "delivery.enable_output",
  disable: "delivery.disable_output",
  volume: "delivery.set_output_volume",
  play: "delivery.play_output",
  pause: "delivery.pause_output"
} as const;

export type OutputPayload = { output_id: string };
export type OutputVolumePayload = { output_id: string; volume: number };

export function outputPayload(outputId: string): OutputPayload {
  return { output_id: outputId };
}

/** The volume payload, or null when the volume is not a whole number
 *  from 0 to 100 - nothing above 100 is ever sent. */
export function outputVolumePayload(outputId: string, volume: number): OutputVolumePayload | null {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) return null;
  return { output_id: outputId, volume };
}

/** One output's state as the plugin answers it. */
export interface OutputState {
  outputId: string;
  enabled: boolean;
  playing: boolean;
  /** The last volume set through the volume verb; null when none. */
  volume: number | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function decodeOutputState(raw: unknown): OutputState | null {
  if (!isObject(raw)) return null;
  const o = raw["output"];
  if (!isObject(o)) return null;
  const outputId = o["output_id"];
  if (typeof outputId !== "string" || outputId.length === 0) return null;
  const v = o["volume"];
  return {
    outputId,
    enabled: o["enabled"] === true,
    playing: o["playing"] === true,
    volume: typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null
  };
}
