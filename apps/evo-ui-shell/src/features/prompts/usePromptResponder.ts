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
//   3. when granted: SEED via list_user_interactions, then
//      subscribe to happenings and RE-SEED on ui_shelf_changed for
//      prompts.active;
//   4. answer / cancel via answer_user_interaction /
//      cancel_user_interaction;
//   5. on unmount: RELEASE the responder slot and abort this
//      feature's subscription — do NOT close the page-lifetime
//      socket (Strict Mode remount would otherwise drop the claim
//      race and open a second upgrade).
//
// When the capability is not granted the hook reports "inactive"
// and the surface renders NOTHING.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { connectWithRetry } from "../../runtime/connect-retry";
import { frameworkUrl } from "../../runtime/use-shelf-subject";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { DEFAULT_OPEN_DEADLINE_MS } from "../../runtime/deadline";
import { storedBearer } from "../../runtime/bearer";
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
      bearerToken: storedBearer(),
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
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const transportRef = useRef<WsTransport | null>(null);
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

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setStatus("error");
      return;
    }
    let cancelled = false;
    const transport = pageLifetimePromptTransport();
    transportRef.current = transport;
    const subAbort = new AbortController();
    let offHappening: (() => void) | undefined;

    const reseed = async (): Promise<void> => {
      const result = await transport.dispatch("list_user_interactions", {});
      if (cancelled || result.error !== undefined) return;
      const decoded = decodeUserInteractions(result.value);
      if (decoded !== null) setPrompts(decoded);
    };

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

    const isPromptShelfChange = (raw: unknown): boolean => {
      if (typeof raw !== "object" || raw === null) return false;
      let rec = raw as Record<string, unknown>;
      const inner = rec["happening"];
      if (typeof inner === "object" && inner !== null) {
        rec = inner as Record<string, unknown>;
      }
      const variant = rec["type"] ?? rec["kind"] ?? rec["variant"];
      if (variant !== "ui_shelf_changed") return false;
      const shelf = rec["shelf"] ?? rec["shelf_id"] ?? rec["shelfId"];
      return shelf === "prompts.active";
    };

    const run = async (): Promise<void> => {
      try {
        if (!transport.isOpen()) {
          await connectWithRetry(transport, () => undefined, () => cancelled);
        }
        if (cancelled) return;
        let granted = await negotiateOnce();
        while (!granted && !cancelled) {
          setStatus("inactive");
          setResponderGranted(false);
          await new Promise((r) => setTimeout(r, 5000));
          if (cancelled) return;
          granted = await negotiateOnce();
        }
        if (cancelled) return;
        setStatus("active");
        setResponderGranted(true);
        await reseed();
        if (cancelled) return;
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
      } catch {
        if (!cancelled) {
          setStatus("error");
          setResponderGranted(false);
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
      setResponderGranted(false);
      transportRef.current = null;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
      // Release the responder role; keep the page-lifetime socket.
      void transport.dispatch("release_user_interaction_responder", {}).catch(() => {
        // Disconnect-release covers this path.
      });
    };
  }, [reauthNonce]);

  const finish = useCallback(
    async (
      op: "answer_user_interaction" | "cancel_user_interaction",
      payload: Record<string, unknown>
    ): Promise<{ ok: boolean; message?: string }> => {
      const transport = transportRef.current;
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
      const r = await finish("answer_user_interaction", encodeAnswer(item, a));
      if (r.ok) {
        setPrompts((prev) =>
          prev.filter((p) => !(p.plugin === item.plugin && p.promptId === item.promptId))
        );
      }
      return r;
    },
    [finish]
  );

  const cancel = useCallback(
    async (item: PromptItem) => {
      const r = await finish("cancel_user_interaction", encodeCancel(item));
      if (r.ok) {
        setPrompts((prev) =>
          prev.filter((p) => !(p.plugin === item.plugin && p.promptId === item.promptId))
        );
      }
      return r;
    },
    [finish]
  );

  return { status, prompts, answer, cancel };
}
