// Reads the composite /api/v1/audio/track_detail for the current
// track and returns its decoded reconciliation.
//
// STATE-DRIVEN, no timers: it fetches exactly once when the track
// (mpdPath) changes, aborts the in-flight request on a track change or
// unmount, and clears stale detail immediately so the strip never
// shows the previous track's facts. A slow read simply resolves later
// - it never blocks or blanks the now-playing surface, which renders
// from now_playing independently.
//
// This is a secondary read on the now-playing surface only; it never
// runs on the player boot critical path.

import { useEffect, useState } from "preact/hooks";
import {
  decodeTrackDetail,
  type TrackDetail
} from "./track-detail-decoders";

/** Lifecycle of the track_detail read, so consumers distinguish an
 *  in-flight fetch from a finished-but-empty result and from a failure -
 *  a completed miss must never read as "loading" forever. */
export type TrackDetailPhase = "idle" | "loading" | "ready" | "error";

export interface TrackDetailState {
  detail: TrackDetail | null;
  phase: TrackDetailPhase;
}

export function useTrackDetail(mpdPath: string | null): TrackDetailState {
  const [state, setState] = useState<TrackDetailState>({
    detail: null,
    phase: "idle"
  });

  useEffect(() => {
    if (mpdPath === null || typeof fetch === "undefined") {
      setState({ detail: null, phase: "idle" });
      return;
    }
    setState({ detail: null, phase: "loading" });
    let cancelled = false;
    const controller = new AbortController();
    const url =
      "/api/v1/audio/track_detail?scheme=mpd-path&value=" +
      encodeURIComponent(mpdPath);
    void (async (): Promise<void> => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) {
          setState({ detail: null, phase: "error" });
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const decoded = decodeTrackDetail(json);
        setState(
          decoded !== null
            ? { detail: decoded, phase: "ready" }
            : { detail: null, phase: "error" }
        );
      } catch {
        // Aborted (track change / unmount) leaves cancelled=true and we
        // do nothing; a genuine network error surfaces as `error` so the
        // UI shows an honest failure, not an eternal spinner.
        if (!cancelled) setState({ detail: null, phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mpdPath]);

  return state;
}
