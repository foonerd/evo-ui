import type { StepUpSessionPayload } from "./types";

export function isStepUpSessionActive(
  session: StepUpSessionPayload | null,
  nowMs: number = Date.now()
): boolean {
  if (!session) {
    return false;
  }
  const expiryMs = Date.parse(session.expires_at);
  if (!Number.isFinite(expiryMs)) {
    return false;
  }
  return expiryMs > nowMs;
}

export function getStepUpRemainingSeconds(
  session: StepUpSessionPayload | null,
  nowMs: number = Date.now()
): number {
  if (!session) {
    return 0;
  }
  const expiryMs = Date.parse(session.expires_at);
  if (!Number.isFinite(expiryMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((expiryMs - nowMs) / 1000));
}
