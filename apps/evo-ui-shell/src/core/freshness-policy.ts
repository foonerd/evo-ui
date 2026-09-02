export const SNAPSHOT_STALE_AFTER_MS = 5000;

export function shouldMarkSnapshotStale(ageMs: number): boolean {
  return ageMs > SNAPSHOT_STALE_AFTER_MS;
}
