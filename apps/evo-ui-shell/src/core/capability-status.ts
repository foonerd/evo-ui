import type { CapabilityStatus } from "./types";

export function combineCapabilityStatuses(statuses: CapabilityStatus[]): CapabilityStatus {
  if (statuses.length === 0) {
    return "missing";
  }

  const allMissing = statuses.every((status) => status === "missing");
  if (allMissing) {
    return "missing";
  }

  const allSupported = statuses.every((status) => status === "supported");
  if (allSupported) {
    return "supported";
  }

  return "partial";
}
