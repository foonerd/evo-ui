export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarizeLatencyMs(samples: number[]): LatencySummary {
  const sanitized = samples
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .map((sample) => Math.round(sample))
    .sort((a, b) => a - b);

  if (sanitized.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }

  return {
    count: sanitized.length,
    p50: pickPercentile(sanitized, 0.5),
    p95: pickPercentile(sanitized, 0.95),
    p99: pickPercentile(sanitized, 0.99),
    max: sanitized[sanitized.length - 1]
  };
}

function pickPercentile(sortedSamples: number[], ratio: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * ratio) - 1)
  );
  return sortedSamples[index];
}
