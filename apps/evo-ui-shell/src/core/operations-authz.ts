import type { CapabilityStatus } from "./types";

export function canRunPrivilegedOperation(
  capabilityStatus: CapabilityStatus,
  hasActiveStepUp: boolean
): boolean {
  return capabilityStatus !== "missing" && hasActiveStepUp;
}

export function needsStepUpReauth(errorMessage: string | null): boolean {
  if (!errorMessage) {
    return false;
  }
  return errorMessage.includes("step_up_required") || errorMessage.includes("scope.system.admin");
}
