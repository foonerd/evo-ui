// useHouseholdProtection - read-then-subscribe for the household policy.
//
// household_protection_get / household_protection_set are DIRECT wire ops
// on /api/v1/ws (not shelf verbs), so they go through transport.dispatch -
// which funnels every dispatch through the ONE inline-step-up path. get is
// never step-up; set is elevatable, so a widening set that the framework
// answers with step_up_required raises the single operator-password card
// (StepUpHost) and retries with the token, with no per-surface gate here.
// Neither op is on NON_ELEVATABLE_OPS.
//
// Get rides the shared page-lifetime transport (anonymous LAN-trust).
// Set does not, when a kiosk/pair bearer is stored: StepUpHost binds
// the sitting to that bearer, and a widen on the anonymous socket
// cannot spend it. This hook owns its subscription + listeners; the
// write socket is one-shot and closed after the set.
//
// State flow (frozen wire): first paint = household_protection_get; the
// happenings bus (household_protection_changed, spectrum denied as every
// other consumer) replaces the core fields in place; the catalog is never on
// the happening, so applyHappening reuses the last get's catalog. No poll.
// A reconnect re-seeds via onConnectionChange("open") so a change missed
// during the gap is picked up without polling.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import {
  frameworkWsUrl,
  tryUseFrameworkTransport
} from "../../runtime/framework-transport";
import { attachSharedHappenings } from "../../runtime/shared-framework-attach";
import { isElevationRequired } from "../../runtime/step-up-elevation.ts";
import { WsTransport } from "../../runtime/ws-transport.ts";
import { t } from "../../runtime/i18n";
import {
  decodeHouseholdSnapshot,
  decodeHouseholdHappening,
  applyHappening,
  buildSetBody,
  householdSetAdmission,
  householdWriteSocket,
  HOUSEHOLD_GET_OP,
  HOUSEHOLD_SET_OP,
  type HouseholdSnapshot,
  type HouseholdSetInput
} from "./household-protection";
import type { WireOpResult } from "../../sdk/types";

export type HouseholdSetResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Refused locally: this session holds no bearer, so the set was
       *  not dispatched. The surface sends the operator to the existing
       *  pair door. */
      pairRequired?: true;
    };

/** Set/unlock on the sitting's caller. Get stays on the shared
 *  LAN-trust socket (it never needs a sitting). */
async function dispatchHouseholdSet(
  shared: WsTransport,
  body: Record<string, unknown>
): Promise<WireOpResult> {
  if (householdWriteSocket(storedBearer() !== undefined) === "shared") {
    return shared.dispatch(HOUSEHOLD_SET_OP, body);
  }
  const bearer = storedBearer();
  if (bearer === undefined) {
    return shared.dispatch(HOUSEHOLD_SET_OP, body);
  }
  const write = new WsTransport({
    url: frameworkWsUrl(),
    bearerToken: bearer
  });
  try {
    return await write.dispatch(HOUSEHOLD_SET_OP, body);
  } finally {
    await write.close();
  }
}

export interface HouseholdProtection {
  /** false in designer / tests with no transport - the modal stays inert. */
  ready: boolean;
  /** null until the first get resolves; the first-paint gate keys on
   *  snapshot?.chosen === false, so it must stay null (not a fabricated
   *  default) while the read is in flight. */
  snapshot: HouseholdSnapshot | null;
  /** The last household get answered with an error and no snapshot has
   *  landed since: the surfaces paint that, with a retry, instead of an
   *  in-flight Loading. null while the get is in flight or once one has
   *  landed. Never a fabricated snapshot in its place. */
  seedError: string | null;
  /** Re-run the household get (the retry on a failed seed). */
  reseed: () => void;
  busy: boolean;
  error: string | null;
  /** Apply a level (+ lend + optional protected_groups). A widening set the
   *  framework gates raises the password card via transport.dispatch. */
  set: (input: HouseholdSetInput) => Promise<HouseholdSetResult>;
  /** Unlock: lend:false with no level, so the Framework restores prior_level.
   *  There is no second unlock op. */
  unlock: () => Promise<HouseholdSetResult>;
  /** Drop a pair-first refusal once the operator has paired. Clears
   *  ONLY that error (a refusal from the player stays until the next
   *  write answers it); never saves, never dispatches. Also driven by
   *  the bearer bus, so a pair completed on another surface clears it. */
  clearPairFirst: () => void;
}

export function useHouseholdProtection(): HouseholdProtection {
  const transport = tryUseFrameworkTransport();
  const [snapshot, setSnapshotState] = useState<HouseholdSnapshot | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  // Bumped by reseed(): re-runs the seed read without touching the shared
  // subscription (a retry is one more get, not a new attach).
  const [seedNonce, setSeedNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which kind of refusal `error` currently carries, so a pair can clear
  // the one it cures and nothing else.
  const lastRefusalRef = useRef<"pair-first" | null>(null);

  // Mirror the snapshot into a ref so the happening folder (which reuses the
  // catalog) and the reconnect re-seed can read the current value without
  // re-subscribing.
  const snapRef = useRef<HouseholdSnapshot | null>(null);
  // The current seed closure, so a retry re-runs the same get on the same
  // socket without re-attaching the subscription.
  const seedRef = useRef<(() => Promise<void>) | null>(null);
  const setSnapshot = useCallback((next: HouseholdSnapshot | null) => {
    snapRef.current = next;
    setSnapshotState(next);
  }, []);

  useEffect(() => {
    if (transport === null) return;
    let cancelled = false;

    // A failed get is recorded, never swallowed: the gate paints it with
    // a retry instead of an in-flight Loading. A later landed get (retry
    // or reconnect re-seed) clears it. No snapshot is ever fabricated.
    const seed = async (): Promise<void> => {
      const r = await transport.dispatch(HOUSEHOLD_GET_OP, {});
      if (cancelled) return;
      if (r.error !== undefined) {
        setSeedError(r.error.message ?? r.error.code ?? t("household.loadFailed"));
        return;
      }
      setSeedError(null);
      setSnapshot(decodeHouseholdSnapshot(r.value));
    };
    seedRef.current = seed;

    const fold = (raw: unknown): void => {
      if (cancelled) return;
      const h = decodeHouseholdHappening(raw);
      if (h === null) return;
      const prev = snapRef.current;
      // Before the first get resolves there is no catalog to reuse; the get
      // reads current truth, so a happening arriving in that window is
      // redundant and safely dropped.
      if (prev === null) return;
      setSnapshot(applyHappening(prev, h));
    };

    // Initial connect + subscribe (spectrum denied) + first seed. The attach
    // never closes the shared socket.
    const attach = attachSharedHappenings(transport, {
      onConnecting: () => {},
      onConnected: () => {},
      onError: () => {},
      isCancelled: () => cancelled,
      afterOpen: seed,
      onHappening: fold
    });

    // Reconnect re-seed: onConnectionChange("open") fires on every successful
    // (re)open, so a change missed during a socket gap is refetched. The
    // initial open may fire this too; a redundant get is idempotent.
    const offConn = transport.onConnectionChange((state) => {
      if (state === "open") void seed();
    });

    return () => {
      cancelled = true;
      seedRef.current = null;
      offConn();
      attach.stop();
    };
  }, [transport, setSnapshot]);

  // Retry: one more get. The failed paint stays until the get answers
  // (no flash back to Loading with nothing new to show), then the seed
  // either clears the error with a snapshot or records the new failure.
  useEffect(() => {
    if (seedNonce === 0) return;
    const seed = seedRef.current;
    if (seed !== null) void seed();
  }, [seedNonce]);

  const reseed = useCallback(() => {
    setSeedNonce((n) => n + 1);
  }, []);

  const set = useCallback(
    async (input: HouseholdSetInput): Promise<HouseholdSetResult> => {
      if (transport === null) {
        return { ok: false, message: t("household.notConnected") };
      }
      // No stored bearer, no set: refused here, nothing dispatched. The
      // framework would admit a narrowing set from LAN-trust, and that is
      // how an unpaired browser could lock a player with no password.
      if (householdSetAdmission(storedBearer() !== undefined) === "pair-first") {
        const message = t("household.pairFirst");
        lastRefusalRef.current = "pair-first";
        setError(message);
        return { ok: false, message, pairRequired: true };
      }
      lastRefusalRef.current = null;
      setBusy(true);
      setError(null);
      try {
        const body = buildSetBody(input) as unknown as Record<string, unknown>;
        // Direct op: dispatch funnels through the step-up card on a
        // step_up_required refusal and retries with the token. The
        // write rides the same caller as that card (kiosk/pair
        // bearer when stored; otherwise the shared LAN-trust
        // socket). See householdWriteSocket.
        const r = await dispatchHouseholdSet(transport, body);
        if (r.error !== undefined) {
          // A widen / Stop lending is step_up_required. transport.dispatch
          // raises the password card and retries with the token; we only get
          // the error back when the operator DISMISSED the card. The change
          // did not apply (we never setSnapshot), so lend is unchanged - show
          // the honest "enter the system password" ask, never the raw 403.
          if (isElevationRequired(r.error)) {
            const message = t("household.stepUpNeeded");
            setError(message);
            return { ok: false, message };
          }
          const message = r.error.message ?? r.error.code ?? t("sources.refused");
          setError(message);
          return { ok: false, message };
        }
        // set returns the post-write snapshot (chosen:true on success).
        setSnapshot(decodeHouseholdSnapshot(r.value));
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [transport, setSnapshot]
  );

  const unlock = useCallback(
    () => set({ lend: false }),
    [set]
  );

  const clearPairFirst = useCallback(() => {
    if (lastRefusalRef.current !== "pair-first") return;
    lastRefusalRef.current = null;
    setError(null);
  }, []);

  // A pair completed anywhere on the page (the modal's door, the Security
  // tile) stores the bearer and announces it: the pair-first line has
  // nothing left to say. Nothing is saved or dispatched here.
  useEffect(
    () =>
      onBearerChange(() => {
        if (storedBearer() !== undefined) clearPairFirst();
      }),
    [clearPairFirst]
  );

  return {
    ready: transport !== null,
    snapshot,
    seedError,
    reseed,
    busy,
    error,
    set,
    unlock,
    clearPairFirst
  };
}
