import type { CapabilitiesPayload, CapabilityStatus } from "./types";

export const REQUIRED_CAPABILITY_KEYS = [
  "playback.transport",
  "queue.crud",
  "browse.library",
  "search.global",
  "metadata.query",
  "artwork.resolve",
  "outputs.selection",
  "network.settings"
] as const;

export function getCapabilityStatus(
  payload: CapabilitiesPayload | null,
  key: string
): CapabilityStatus {
  return payload?.capabilities?.[key] ?? "missing";
}

export function isFeatureSupported(payload: CapabilitiesPayload | null, key: string): boolean {
  return getCapabilityStatus(payload, key) === "supported";
}

export function isFeaturePartial(payload: CapabilitiesPayload | null, key: string): boolean {
  return getCapabilityStatus(payload, key) === "partial";
}
