// Central happenings dispatcher. One WebSocket subscription on
// `subscribe_happenings` feeds every reactive consumer in the shell
// — subject store, stocking store, observability surfaces, audit
// trail. Atomic-sync invariant: every Happening variant tied to a
// subject + revision routes through this one mechanism, not five
// per-feature hand-coded paths.
//
// Reconnect behaviour: the dispatcher persists the highest observed
// `seq` and resubscribes with `since=<last_seq>` so the framework
// replays only the deltas the client missed during the gap.

import { signal, type Signal } from "@preact/signals";

import type { EvoClient } from "../sdk/client";
import type { WsTransport } from "./ws-transport";
import {
  decodeHappening,
  type DecodedHappening,
  SubjectStore,
} from "./subjects";

/**
 * Bounded ring of recent happening envelopes. The renderer's
 * observability surface ("recent activity" tile, audit replay
 * inspector, plugin-author diagnostics) consumes this directly;
 * the framework's full audit ledger remains the long-term record.
 */
export interface ObservedHappening {
  readonly seq: number;
  readonly variant: string;
  readonly atMs: number;
  readonly raw: unknown;
}

const RECENT_CAPACITY = 256;

/**
 * The central happenings dispatcher. Wired at boot — the runtime
 * passes its handles to {@link HappeningsDispatcher.attach} which
 * starts the subscription stream and routes every decoded
 * happening to the correct store.
 */
export class HappeningsDispatcher {
  public readonly recent: Signal<readonly ObservedHappening[]> = signal([]);
  /** Highest `seq` observed; mirrors `SubjectStore.cursor`. */
  public readonly cursor: Signal<number> = signal(0);

  public constructor(private readonly subjects: SubjectStore) {}

  /**
   * Hook the dispatcher onto:
   * 1. The WS transport's happenings fan-out (server-pushed frames
   *    independent of any subscription, used for already-buffered
   *    happenings that arrive before the explicit subscription is
   *    set up).
   * 2. An explicit `subscribe_happenings` subscription so the
   *    `since` cursor on reconnect is respected.
   *
   * Returns a teardown closure the runtime calls on shutdown.
   */
  public attach(
    ws: WsTransport,
    client: EvoClient,
    initialSince: number,
  ): () => void {
    const offFanOut = ws.onHappening((frame) => {
      this.dispatchFrame(frame.seq, frame.happening);
    });

    const subscriptionAbort = new AbortController();
    const dispatchSubscription = async (): Promise<void> => {
      const stream = client.subjects.subscribeHappenings(
        initialSince > 0 ? { since: initialSince } : {},
        { signal: subscriptionAbort.signal },
      );
      try {
        for await (const event of stream) {
          if (!isObject(event)) continue;
          // The wire shape under subscribe_happenings: server emits
          // SubscriptionEvent frames whose `event` field is the
          // Happening payload itself; the seq cursor for replay is
          // a separate concept maintained by the durable bus, so
          // the per-event ordering relies on the server-side
          // monotonic delivery guarantee.
          const seq = numField(event, "seq") ?? this.cursor.value + 1;
          this.dispatchFrame(seq, event.happening ?? event);
        }
      } catch (e) {
        // Subscription terminated — the WS transport's reconnect
        // logic will re-establish; on the next open, the operator-
        // level handle (Runtime) calls `attach` again with the
        // updated cursor so replay resumes from the gap.
        if (!subscriptionAbort.signal.aborted) {
          // eslint-disable-next-line no-console
          console.warn("happenings subscription terminated", e);
        }
      }
    };
    void dispatchSubscription();

    return () => {
      offFanOut();
      subscriptionAbort.abort();
    };
  }

  /**
   * Apply one observed happening to the reactive stores. The
   * routing rule is variant-discriminated: subject-typed variants
   * route to the subject store; ui_shelf_changed routes to the
   * stocking store; everything else lands in the recent ring as an
   * `other` for observability without disturbing the reactive
   * surfaces.
   */
  private dispatchFrame(seq: number, raw: unknown): void {
    const decoded = decodeHappening(seq, raw);
    this.recordRecent(seq, decoded, raw);
    if (decoded === null) return;
    if (seq > this.cursor.value) this.cursor.value = seq;
    switch (decoded.kind) {
      case "subject_state_changed":
        this.subjects.applyStateChanged(
          decoded.seq,
          decoded.canonicalId,
          decoded.subjectType,
          decoded.owningPlugin,
          decoded.state,
          decoded.atMs,
        );
        return;
      case "subject_forgotten":
        this.subjects.applyForget(decoded.seq, decoded.canonicalId);
        return;
      case "subject_merged":
        for (const retired of decoded.retiredIds) {
          this.subjects.applyForget(decoded.seq, retired);
        }
        return;
      case "subject_split":
        this.subjects.applyForget(decoded.seq, decoded.retiredId);
        return;
      case "ui_shelf_changed":
        // Stocking-store reconciliation happens through the
        // boot layer's `ws.onHappening` hook, which decodes the
        // full envelope context the composition resolver needs.
        // This branch records the variant in the recent-ring
        // through `recordRecent` above; the reactive store update
        // is single-sourced from the boot-layer decoder.
        return;
      case "other":
        return;
    }
  }

  private recordRecent(
    seq: number,
    decoded: DecodedHappening | null,
    raw: unknown,
  ): void {
    const variant =
      decoded?.kind === "other"
        ? decoded.variant
        : (decoded?.kind ?? "<undecoded>");
    const entry: ObservedHappening = {
      seq,
      variant,
      atMs: Date.now(),
      raw,
    };
    const next = [entry, ...this.recent.value].slice(0, RECENT_CAPACITY);
    this.recent.value = Object.freeze(next);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}
