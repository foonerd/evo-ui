import type { CapabilityStatus } from "./types";

export function shouldRefreshFromAnomaly(
  anomalySignal: number,
  status: CapabilityStatus
): boolean {
  return anomalySignal > 0 && status !== "missing";
}
