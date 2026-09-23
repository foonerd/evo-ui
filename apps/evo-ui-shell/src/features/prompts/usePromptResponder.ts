// usePromptResponder - the shell's user_interaction_responder
// consumer (Phase 1b).
//
// Lifecycle per the framework contract (verified on the wire
// 2026-07-17):
//   1. page-lifetime WsTransport WITH bearer (capability is
//      bearer-scope gated). Kept SEPARATE from FrameworkTransport
//      so a token never rewrites LAN-trust grants for playback;
//   2. negotiate { capabilities: ["user_interaction_responder"] } -
//      single-responder lock, first claimer wins. RETRY while not
//      granted;
//   3. on every open: LIST via list_user_interactions at once - the
//      framework admits the origin door without the seat (a session
//      sees the prompts its own dispatches raised; refused
//      user_interaction_responder_not_granted when none of its own is
//      open, which this hook treats as silence) - then subscribe to
//      happenings and RE-LIST on ui_shelf_changed for prompts.active;
//      when the seat is granted the same list returns every open
//      prompt;
//   4. answer / cancel via answer_user_interaction /
//      cancel_user_interaction - the origin answers its own card
//      without the seat, the seat holder answers any;
//   5. on unmount: RELEASE the responder slot and abort this
//      feature's subscription - do NOT close the page-lifetime
//      socket (Strict Mode remount would otherwise drop the claim
//      race and open a second upgrade).
//
// When the capability is not granted the hook reports "inactive";
// the surface still paints the prompts this session's own dispatches
// raised — including those listed on a registered write socket (Add
// share), which is a different connection from this seat socket. The
// seat is never taken in order to paint.
//
// The seat is bound to the SOCKET, not the page: the framework releases
// it on disconnect. So the claim is re-run on every reopen of the
// page-lifetime socket (steward bounce, deploy, kiosk day-up remint at
// token expiry), and "active" is never painted for a socket that is not
// open. The socket reads the CURRENT stored bearer at every handshake -
// a kiosk silent remint or an inline pair is what the next upgrade
// carries - and it never negotiates anonymously: LAN-trust cannot hold
// the seat, so a session without a bearer does not open this socket at
// all. A bearer socket that will not (re)open runs the stale-bearer
// policy (anonymous probe; purge only when a read lands).

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { connectWithRetry, reconnectDelayMs } from "../../runtime/connect-retry";
import { frameworkUrl } from "../../runtime/use-shelf-subject";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { DEFAULT_OPEN_DEADLINE_MS } from "../../runtime/deadline";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { shouldClaimResponder } from "../../runtime/bearer-handshake";
import { probeStaleBearer } from "../../runtime/stale-bearer-probe";
import {
  applyPromptList,
  finishPrompt,
  type PromptListState
} from "./prompt-list-outcome";
import { originListSilence } from "./origin-list";
import {
  applyOriginWriteList,
  isPromptShelfChange,
  mergePromptLists,
  promptAnswerOnWrite,
  promptKey
} from "./prompt-origin-write";
import {
  onOriginWriteReseed,
  onOriginWriteTransportsChange,
  originWriteTransports
} from "./origin-write-registry";
import { verbErrorMessage } from "../../runtime/verb-error";
import { t } from "../../runtime/i18n";
import {
  decodeUserInteractions,
  encodeAnswer,
  encodeCancel,
  type PromptAnswer,
  type PromptItem
} from "./prompt-decoders";

export type PromptResponderStatus =
  | "connecting"
  | "active"
  | "inactive"
  | "error";

export interface PromptResponderState {
  status: PromptResponderStatus;
  /** Open prompts, framework order (priority then creation). */
  prompts: PromptItem[];
  /** The last list_user_interactions did not land (refused, socket
   *  gone, unreadable) and nothing has landed since. The prompts above
   *  are whatever landed before - never cleared by a failure. null
   *  while in flight or once a list has landed. */
  listError: string | null;
  /** Re-run the same list on the same socket (the retry on a failed
   *  list). No second negotiate, no second subscription. */
  relist: () => void;
  answer: (item: PromptItem, a: PromptAnswer) => Promise<{ ok: boolean; message?: string }>;
  cancel: (item: PromptItem) => Promise<{ ok: boolean; message?: string }>;
}

const RESPONDER_CAPABILITY = "user_interaction_responder";

// ---- page-lifetime prompt transport ---------------------------
// Bearer-scoped; torn down on real page unload via WsTransport
// pagehide. Never closed from React effect cleanup.

let pagePromptTransport: WsTransport | null = null;

function pageLifetimePromptTransport(): WsTransport {
  if (pagePromptTransport === null) {
    pagePromptTransport = new WsTransport({
      url: frameworkUrl(),
      // Read at EVERY handshake, never a construction snapshot: the
      // kiosk's silent remint rewrites localStorage from outside the
      // page, and the next reopen (at old-token expiry) must carry it.
      bearerSource: storedBearer,
      openTimeoutMs: DEFAULT_OPEN_DEADLINE_MS
    });
  }
  return pagePromptTransport;
}

// ---- responder-availability singleton -------------------------
//
// Root-caused 2026-07-20 (the "no password prompt" TERMINATION bug):
// a session without the responder grant can still START credential
// flows while the UI cannot render the prompt. Surfaces gate on this.

let responderGranted = false;
const responderListeners = new Set<() => void>();

function setResponderGranted(next: boolean): void {
  if (responderGranted === next) return;
  responderGranted = next;
  for (const l of responderListeners) l();
}

let promptListed = false;
const promptListedListeners = new Set<() => void>();

function setPromptListed(next: boolean): void {
  if (promptListed === next) return;
  promptListed = next;
  for (const l of promptListedListeners) l();
}

// ---- in-place reauth after inline pairing ---------------------
//
// The prompt transport is a page-lifetime singleton seeded with the
// bearer at first use. After inline pairing on a settings surface we
// must rebuild it with the NEW bearer and renegotiate the responder
// role - WITHOUT a page reload, so the operator stays where they paired
// (Sources). Bumping the nonce re-runs usePromptResponder's effect,
// which rebuilds the singleton (below) and renegotiates.

let promptReauthNonce = 0;
const promptReauthListeners = new Set<() => void>();

/** Drop the paired prompt socket + renegotiate the responder with the
 *  freshly stored bearer, in place. Call right after PairDeviceFlow's
 *  onPaired so SMB password prompts can render here with no reload. */
export function reauthPromptResponder(): void {
  if (pagePromptTransport !== null) {
    const old = pagePromptTransport;
    pagePromptTransport = null; // next pageLifetimePromptTransport() rebuilds with the new bearer
    void old.close();
  }
  setResponderGranted(false);
  promptReauthNonce += 1;
  for (const l of promptReauthListeners) l();
}

/** A prompt this session can paint is listed (seat or write origin). */
export function usePromptListed(): boolean {
  const [listed, setListed] = useState(promptListed);
  useEffect(() => {
    const l = (): void => setListed(promptListed);
    promptListedListeners.add(l);
    return () => {
      promptListedListeners.delete(l);
    };
  }, []);
  return listed;
}

/** Whether THIS session currently holds the prompt-responder role -
 *  i.e. password prompts raised by the framework will render here. */
export function useResponderGranted(): boolean {
  const [granted, setGranted] = useState(responderGranted);
  useEffect(() => {
    const l = (): void => setGranted(responderGranted);
    responderListeners.add(l);
    return () => {
      responderListeners.delete(l);
    };
  }, []);
  return granted;
}

export function usePromptResponder(): PromptResponderState {
  const [status, setStatus] = useState<PromptResponderStatus>("connecting");
  // The landed prompts and the record of a list that did not land,
  // as ONE state: every change is a functional update over the previous
  // value, so a re-seed that fails keeps exactly what had landed and two
  // in-flight finishes can never restore a neighbour prompt.
  const [list, setList] = useState<PromptListState>({ prompts: [], listError: null });
  const [writePrompts, setWritePrompts] = useState<PromptItem[]>([]);
  const [writeTick, setWriteTick] = useState(0);
  const prompts = mergePromptLists(writePrompts, list.prompts);
  const listError = list.listError;
  useEffect(() => {
    setPromptListed(prompts.length > 0);
  }, [prompts]);
  const transportRef = useRef<WsTransport | null>(null);
  const writeByKeyRef = useRef<Map<string, WsTransport>>(new Map());
  // The current effect's reseed closure, so a retry re-runs the same
  // list on the same socket without touching the claim or the subscription.
  const reseedRef = useRef<(() => Promise<void>) | null>(null);
  const writeReseedRef = useRef<(() => Promise<void>) | null>(null);
  // Re-run the negotiation effect when reauthPromptResponder() fires
  // (after inline pairing) so the responder re-handshakes with the new
  // bearer in place.
  const [reauthNonce, setReauthNonce] = useState(promptReauthNonce);
  useEffect(() => {
    const l = (): void => setReauthNonce(promptReauthNonce);
    promptReauthListeners.add(l);
    return () => {
      promptReauthListeners.delete(l);
    };
  }, []);
  // The one bearer bus: a pair stored a token (claim it now, in place) or
  // the stale-bearer policy purged one (drop the seat, stop claiming).
  // Both rebuild the page-lifetime socket with the current bearer.
  useEffect(() => onBearerChange(reauthPromptResponder), []);

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setStatus("error");
      return;
    }
    // No bearer, no seat: LAN-trust never carries the responder
    // capability, so an anonymous socket must not even ask. Stay
    // inactive; the bearer bus re-runs this effect when a pair stores one.
    if (!shouldClaimResponder(storedBearer())) {
      setStatus("inactive");
      setResponderGranted(false);
      return undefined;
    }
    let cancelled = false;
    const transport = pageLifetimePromptTransport();
    transportRef.current = transport;
    const subAbort = new AbortController();
    let offHappening: (() => void) | undefined;
    let offConn: (() => void) | undefined;
    let offReconnectFailed: (() => void) | undefined;

    // Whether THIS socket holds the seat right now. Written by the claim
    // loop and the drop handler only; read by the list so a refusal is
    // told apart from silence.
    let seatHeld = false;

    // Seed / re-seed the open-prompt list - on every open, seat or not.
    // The seat holder gets every open prompt; a session without the seat
    // gets the prompts its own dispatches raised (the origin door), and
    // is refused not-granted when none of its own is open: that refusal
    // is silence for it - nothing to paint, nothing to record. Any other
    // list that does not land keeps every prompt that already did and
    // records why, so the seat holder never paints an empty seat over a
    // live prompt; a landed list replaces the prompts and clears the record.
    const reseed = async (): Promise<void> => {
      const result = await transport.dispatch("list_user_interactions", {});
      if (cancelled) return;
      if (originListSilence(result, seatHeld)) {
        setList({ prompts: [], listError: null });
        return;
      }
      setList((prev) =>
        applyPromptList(prev.prompts, result, decodeUserInteractions, () =>
          t("prompt.listUnreadable")
        )
      );
      const writeReseed = writeReseedRef.current;
      if (writeReseed !== null) void writeReseed();
    };
    reseedRef.current = reseed;

    const negotiateOnce = async (): Promise<boolean> => {
      const negotiated = await transport.dispatch("negotiate", {
        capabilities: [RESPONDER_CAPABILITY]
      });
      return (
        negotiated.error === undefined &&
        typeof negotiated.value === "object" &&
        negotiated.value !== null &&
        Array.isArray((negotiated.value as Record<string, unknown>)["granted"]) &&
        ((negotiated.value as Record<string, unknown>)["granted"] as unknown[]).includes(
          RESPONDER_CAPABILITY
        )
      );
    };

    // Claim the seat on THIS open socket: negotiate until granted (the
    // seat is single-holder, first claimer wins), then seed. Re-run on
    // every reopen - the framework releases the seat on disconnect, so a
    // claim from a previous socket is gone. Stops the moment the socket
    // drops or the effect is torn down. The origin list runs beside this
    // loop, never behind it: the seat is not taken in order to paint.
    let claimGen = 0;
    const claim = async (): Promise<void> => {
      claimGen += 1;
      const gen = claimGen;
      const stale = (): boolean =>
        cancelled || gen !== claimGen || !transport.isOpen();
      let granted = await negotiateOnce();
      while (!granted && !stale()) {
        seatHeld = false;
        setStatus("inactive");
        setResponderGranted(false);
        await new Promise((r) => setTimeout(r, 5000));
        if (stale()) return;
        granted = await negotiateOnce();
      }
      if (stale() || !granted) return;
      seatHeld = true;
      setStatus("active");
      setResponderGranted(true);
      await reseed();
    };

    // A bearer socket that will not (re)open: the same stale-bearer
    // policy the shelf subjects run. The probe read is a capability-none
    // `negotiate` with an EMPTY capability list on a private anonymous
    // socket - it claims nothing (the seat is never asked for
    // anonymously); it only proves the device answers. A landed read
    // purges the dead bearer (the bus then re-runs this effect, which
    // stays inactive without a bearer). A failed anonymous connect keeps
    // the token: the device is down.
    let probeInFlight = false;
    const probe = async (): Promise<"purge" | "device-down" | "backout" | "cancelled"> => {
      if (probeInFlight) return "cancelled";
      probeInFlight = true;
      try {
        return await probeStaleBearer({
          url: frameworkUrl(),
          read: async (anon) => {
            const r = await anon.dispatch("negotiate", { capabilities: [] });
            return r.error === undefined;
          },
          isCancelled: () => cancelled
        });
      } finally {
        probeInFlight = false;
      }
    };

    const run = async (): Promise<void> => {
      // First open. The transport's own reconnect only arms after a
      // socket has opened once, so the first open retries here with the
      // canonical unbounded schedule - probing the bearer between
      // rounds so a dead token is purged instead of retried forever.
      let attempt = 0;
      while (!transport.isOpen()) {
        if (cancelled) return;
        attempt += 1;
        try {
          await connectWithRetry(transport, () => undefined, () => cancelled);
        } catch {
          if (cancelled) return;
          setStatus("inactive");
          setResponderGranted(false);
          const outcome = await probe();
          if (cancelled || outcome === "purge") return;
          await new Promise<void>((resolve) =>
            setTimeout(resolve, reconnectDelayMs(attempt))
          );
        }
      }
      if (cancelled) return;

      // `active` is painted only while THIS socket is open. A drop
      // releases the seat server-side: paint inactive at once, and claim
      // again on the reopen. A failed reopen attempt probes the bearer.
      // Every open lists first (the origin door needs no seat), then
      // claims.
      offConn = transport.onConnectionChange((socketState) => {
        if (cancelled) return;
        if (socketState === "open") {
          void reseed();
          void claim();
        } else {
          claimGen += 1;
          seatHeld = false;
          setStatus("inactive");
          setResponderGranted(false);
        }
      });
      offReconnectFailed = transport.onReconnectAttemptFailed(() => {
        void probe();
      });

      const handleHappening = (raw: unknown): void => {
        if (cancelled) return;
        if (isPromptShelfChange(raw)) void reseed();
      };
      offHappening = transport.onHappening((f) => handleHappening(f.happening));
      void (async (): Promise<void> => {
        const stream = transport.subscribe(
          "subscribe_happenings",
          DENY_SPECTRUM_PAYLOAD,
          { signal: subAbort.signal }
        );
        try {
          for await (const event of stream) {
            if (cancelled) return;
            handleHappening(event);
          }
        } catch {
          // Subscription ended; remount re-attaches.
        }
      })();

      void reseed();
      await claim();
    };
    void run();

    return () => {
      cancelled = true;
      setResponderGranted(false);
      transportRef.current = null;
      reseedRef.current = null;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
      if (offConn !== undefined) offConn();
      if (offReconnectFailed !== undefined) offReconnectFailed();
      // Release the responder role; keep the page-lifetime socket.
      if (transport.isOpen()) {
        void transport.dispatch("release_user_interaction_responder", {}).catch(() => {
          // Disconnect-release covers this path.
        });
      }
    };
  }, [reauthNonce]);

  // Write sockets that raised a prompt (Add share) list on THEIR
  // connection. The seat socket above is a different connection and
  // cannot see those cards without the seat.
  useEffect(() => onOriginWriteTransportsChange(() => setWriteTick((n) => n + 1)), []);
  useEffect(() => {
    let cancelled = false;
    const reseedWrites = async (): Promise<void> => {
      const next: PromptItem[] = [];
      const byKey = new Map<string, WsTransport>();
      for (const transport of originWriteTransports().values()) {
        if (!transport.isOpen()) continue;
        const result = await transport.dispatch("list_user_interactions", {});
        if (cancelled) return;
        const landed = applyOriginWriteList(
          [],
          result,
          decodeUserInteractions
        );
        for (const item of landed) {
          const key = promptKey(item);
          if (byKey.has(key)) continue;
          byKey.set(key, transport);
          next.push(item);
        }
      }
      writeByKeyRef.current = byKey;
      setWritePrompts(next);
    };
    writeReseedRef.current = reseedWrites;
    const offNudge = onOriginWriteReseed(() => {
      void reseedWrites();
    });
    void reseedWrites();
    return () => {
      cancelled = true;
      offNudge();
      if (writeReseedRef.current === reseedWrites) writeReseedRef.current = null;
    };
  }, [writeTick]);

  const finish = useCallback(
    async (
      op: "answer_user_interaction" | "cancel_user_interaction",
      payload: Record<string, unknown>,
      item: PromptItem
    ): Promise<{ ok: boolean; message?: string }> => {
      const write = writeByKeyRef.current.get(promptKey(item));
      const transport =
        promptAnswerOnWrite(item, new Set(writeByKeyRef.current.keys())) && write !== undefined
          ? write
          : transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("prompt.notConnected") };
      }
      const result = await transport.dispatch(op, payload);
      if (result.error !== undefined) {
        return {
          ok: false,
          message: verbErrorMessage(result.error, t("prompt.refused"))
        };
      }
      return { ok: true };
    },
    []
  );

  const answer = useCallback(
    async (item: PromptItem, a: PromptAnswer) => {
      const r = await finish("answer_user_interaction", encodeAnswer(item, a), item);
      if (r.ok) {
        // Functional: a second in-flight finish folds over THIS result,
        // never over a snapshot that would restore its neighbour. An
        // emptied list also drops a stale list-failure record.
        setList((prev) => finishPrompt(prev, item));
        setWritePrompts((prev) => prev.filter((p) => promptKey(p) !== promptKey(item)));
        writeByKeyRef.current.delete(promptKey(item));
      }
      return r;
    },
    [finish]
  );

  const cancel = useCallback(
    async (item: PromptItem) => {
      const r = await finish("cancel_user_interaction", encodeCancel(item), item);
      if (r.ok) {
        setList((prev) => finishPrompt(prev, item));
        setWritePrompts((prev) => prev.filter((p) => promptKey(p) !== promptKey(item)));
        writeByKeyRef.current.delete(promptKey(item));
      }
      return r;
    },
    [finish]
  );

  const relist = useCallback(() => {
    const reseed = reseedRef.current;
    if (reseed !== null) void reseed();
    const writeReseed = writeReseedRef.current;
    if (writeReseed !== null) void writeReseed();
  }, []);

  return { status, prompts, listError, relist, answer, cancel };
}
