import {
  REQUIRED_CAPABILITY_KEYS,
  getCapabilityStatus
} from "./feature-gates.ts";
import type { BootstrapPhase, CapabilitiesPayload, HealthPayload } from "./types";

export function hasRequiredCapabilityGaps(capabilities: CapabilitiesPayload): boolean {
  return REQUIRED_CAPABILITY_KEYS.some((key) => {
    const status = getCapabilityStatus(capabilities, key);
    return status === "partial" || status === "missing";
  });
}

export function resolveBootstrapPhase(params: {
  health: HealthPayload;
  capabilities: CapabilitiesPayload;
}): Exclude<BootstrapPhase, "idle" | "connecting"> {
  if (params.health.status === "down") {
    return "offline";
  }
  if (params.health.status === "degraded" || hasRequiredCapabilityGaps(params.capabilities)) {
    return "degraded";
  }
  return "ready";
}
