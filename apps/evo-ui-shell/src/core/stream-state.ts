import type { UiEventFrame } from "./types";

export interface StreamState {
  status: "idle" | "connecting" | "open" | "closed" | "error";
  reason: string | null;
  lastEvent: UiEventFrame | null;
  eventsSeen: number;
  lastSeq: number | null;
  eventCounts: Record<string, number>;
  seqGapCount: number;
  seqRegressionCount: number;
}

export const INITIAL_STREAM_STATE: StreamState = {
  status: "idle",
  reason: null,
  lastEvent: null,
  eventsSeen: 0,
  lastSeq: null,
  eventCounts: {},
  seqGapCount: 0,
  seqRegressionCount: 0
};

export function buildStreamNextState(prev: StreamState, frame: UiEventFrame): StreamState {
  let seqGapCount = prev.seqGapCount;
  let seqRegressionCount = prev.seqRegressionCount;
  const incomingSeq = typeof frame.seq === "number" ? frame.seq : null;

  if (incomingSeq !== null && prev.lastSeq !== null) {
    if (incomingSeq <= prev.lastSeq) {
      seqRegressionCount += 1;
    } else if (incomingSeq - prev.lastSeq > 1) {
      seqGapCount += 1;
    }
  }

  return {
    ...prev,
    lastEvent: frame,
    eventsSeen: prev.eventsSeen + 1,
    lastSeq: incomingSeq ?? prev.lastSeq,
    eventCounts: {
      ...prev.eventCounts,
      [frame.event]: (prev.eventCounts[frame.event] ?? 0) + 1
    },
    seqGapCount,
    seqRegressionCount
  };
}
