export function formatRequestId(result: unknown): string {
  return String(result ?? "n/a");
}

export function formatRequestDetail(prefix: string, result: unknown): string {
  return `${prefix} (request ${formatRequestId(result)})`;
}
