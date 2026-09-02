export function formatInFlightSummary(count: number): string {
  if (count <= 0) {
    return "idle";
  }
  return `${count} in-flight`;
}
