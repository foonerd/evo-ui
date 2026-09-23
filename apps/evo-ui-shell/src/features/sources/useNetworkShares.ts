// useNetworkShares / useDiscoveredNas - hooks for the
// networking.shares shelf (Phase 3c: live mutations).
//
// AUTHORITY MODEL (verified on the wire): every mutating verb is
// step-up gated on network_admin. A session holds that scope by
// presenting a bearer minted with it. Presenting a bearer REPLACES
// the anonymous LAN-trust grants, so the working admin mint is:
//
//   evo-plugin-tool admin auth mint-bearer-token \
//     --reason "..." --ttl-seconds 3600 \
//     --scope network_admin --scope plugins --scope subjects
//
// (plugins covers the plugin-request wire op, subjects covers the
// happenings subscription.) The page reads the stored bearer; when
// it carries step_up:network_admin the mutating affordances enable.
//
// Share STATE lives per share (network.share.get_state + the
// network_share_state subject), not on the configured record; this
// hook fetches state for every listed share and folds in state
// happenings, exposing merged items.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  useShelfSubject,
  type SubjectConnectionState,
  type SubjectVerbResult
} from "../../runtime/use-shelf-subject";
import { storedBearer, bearerHasScope } from "../../runtime/bearer";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { t } from "../../runtime/i18n";
import {
  decodeConfiguredShares,
  decodeConfiguredSharesHappening,
  decodeDiscoveredNas,
  decodeDiscoveredNasHappening,
  decodeShareState,
  decodeShareStateHappening,
  decodeShareEvents,
  decodeShareEventsHappening,
  decodeShareMountOutcome,
  shareMountVerbResult,
  type ConfiguredShares,
  type DiscoveredNasList,
  type ShareRecord,
  type ShareStateInfo,
  type ShareEventItem
} from "./share-decoders";
import { rememberShareAliases, stampEventAliases } from "./share-event-alias";
import {
  SHARE_STATE_POLL_MS,
  foldEventsIntoStates,
  preferFresherShareState
} from "./share-state-live";
import {
  nudgeOriginWriteReseed,
  registerOriginWriteTransport,
  unregisterOriginWriteTransport
} from "../prompts/origin-write-registry";
import { isPromptShelfChange } from "../prompts/prompt-origin-write";

const SHELF = "networking.shares";
const ORIGIN_WRITE_ID = "networking.shares";
const ORIGIN_LIST_WHILE_WRITE_MS = 400;

const MESSAGES = {
  wsUnavailable: () => t("collection.wsUnavailable"),
  notConnected: () => t("sources.notConnected"),
  noResponse: (n: number, detail: string) => t("sources.noResponse", { n, detail }),
  refused: () => t("sources.refused")
};

/** True when the stored bearer can drive share mutations. */
export function hasNetworkAdmin(): boolean {
  return bearerHasScope(storedBearer(), "step_up", "network_admin");
}

export interface ShareItem extends ShareRecord {
  state: ShareStateInfo["state"];
  reason: string | null;
  negotiated: string | null;
}

export interface AddSharePayload {
  alias: string;
  fstype: "cifs" | "nfs";
  host: string;
  path: string;
  credentials:
    | { kind: "guest" }
    | {
        kind: "user_password";
        username: string;
        credential_key: string;
        /** AD domain (e.g. CORP) - required for domain-joined
         *  NAS boxes; absent = mount helper infers (standalone). */
        domain?: string;
      };
  /** Typed on the Add dialog. Vaulted by the plugin; never stored
   *  on the share record. */
  password?: string;
  advanced_options?: string;
}

/** Partial edit to an existing share. Only supplied fields change;
 *  omitted fields (incl. credentials + advanced_options) are left as-is
 *  by the device. A material change (host/path/fstype/credentials) makes
 *  the device self-remount, reusing the stored credential. */
export interface EditSharePayload {
  alias?: string;
  fstype?: "cifs" | "nfs";
  host?: string;
  path?: string;
  /** Full Credentials replacement (device replaces the whole enum). */
  credentials?: AddSharePayload["credentials"];
  /** Extra mount options; empty string clears operator options. */
  advanced_options?: string;
}

export interface UseNetworkSharesState {
  connection: SubjectConnectionState;
  /** null until the first read lands. */
  items: ShareItem[] | null;
  /** Recent lifecycle events (mount/unmount/failed), oldest first. */
  events: ShareEventItem[];
  mount: (shareId: string, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  unmount: (shareId: string, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  remove: (shareId: string, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  add: (payload: AddSharePayload, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  edit: (
    shareId: string,
    edits: EditSharePayload,
    extra?: Record<string, unknown>
  ) => Promise<SubjectVerbResult>;
  /** Rebuild the bearer socket in place with the freshly stored token
   *  after inline pairing, so newly-granted network_admin takes effect
   *  WITHOUT a reload (the operator stays on Sources). */
  reauth: () => void;
}

export function useNetworkShares(): UseNetworkSharesState {
  const subject = useShelfSubject<ConfiguredShares>({
    shelf: SHELF,
    bearerSource: storedBearer,
    readRequestType: "network.share.list_configured",
    decodeRead: decodeConfiguredShares,
    decodeHappening: decodeConfiguredSharesHappening,
    messages: MESSAGES
  });
  const { state, request, dispatchVoid, transportRef, reauth } = subject;
  const [states, setStates] = useState<ReadonlyMap<string, ShareStateInfo>>(new Map());
  const [events, setEvents] = useState<ShareEventItem[]>([]);
  const fetchedFor = useRef<string>("");
  // Every name this page has learned for a share_id - from the wire or
  // from a configured record - so an Activity line keeps its alias after
  // the share is removed and the ring is republished without it. Events
  // are stamped at INGEST (below), never resolved at paint time.
  const aliasMemory = useRef<Map<string, string>>(new Map());
  const ingestEvents = useCallback((incoming: ShareEventItem[]): void => {
    setEvents(stampEventAliases(incoming, aliasMemory.current));
    setStates((prev) => foldEventsIntoStates(prev, incoming));
  }, []);

  const applyShareState = useCallback((info: ShareStateInfo): void => {
    setStates((prev) => preferFresherShareState(prev, info));
  }, []);

  const pullShareState = useCallback(
    (shareId: string): void => {
      void request(
        "network.share.get_state",
        { share_id: shareId },
        decodeShareState,
        () => t("sources.refused")
      ).then((r) => {
        if (r.ok) applyShareState(r.value);
      });
    },
    [request, applyShareState]
  );

  // A configured list teaches the memory, and re-stamps the events that
  // arrived before it (the seed order is not guaranteed).
  useEffect(() => {
    if (state === null) return;
    rememberShareAliases(aliasMemory.current, state.shares);
    setEvents((prev) => stampEventAliases(prev, aliasMemory.current));
  }, [state]);

  // Fetch per-share state whenever the share set changes.
  useEffect(() => {
    if (state === null) return;
    const key = state.shares.map((s) => s.shareId).sort().join(",");
    if (key === fetchedFor.current) return;
    fetchedFor.current = key;
    for (const share of state.shares) {
      pullShareState(share.shareId);
    }
  }, [state, pullShareState]);

  // Live state rides subscribe_happenings on this socket. The WS
  // happening fan-out is not that stream — listening only there
  // leaves the card on Connecting after the device is Connected.
  useEffect(() => {
    const transport = transportRef.current;
    if (transport === null) return;
    const applyRaw = (raw: unknown): void => {
      if (isPromptShelfChange(raw)) nudgeOriginWriteReseed();
      const info = decodeShareStateHappening(raw);
      if (info !== null) {
        applyShareState(info);
        return;
      }
      const ev = decodeShareEventsHappening(raw);
      if (ev !== null) ingestEvents(ev.events);
    };
    const off = transport.onHappening((f) => applyRaw(f.happening));
    const abort = new AbortController();
    void (async () => {
      const stream = transport.subscribe(
        "subscribe_happenings",
        DENY_SPECTRUM_PAYLOAD as Record<string, unknown>,
        { signal: abort.signal }
      );
      try {
        for await (const event of stream) {
          applyRaw(event);
        }
      } catch {
        // Remount / reconnect re-subscribes.
      }
    })();
    return () => {
      off();
      abort.abort();
    };
  }, [transportRef, subject.connection.kind, ingestEvents, applyShareState]);

  // The shares bearer socket is the connection that dispatches add /
  // mount. Register it so PromptSurface lists that origin, not only
  // the separate seat socket. LAN-trust (no bearer) does not register.
  useEffect(() => {
    if (subject.connection.kind !== "connected") {
      unregisterOriginWriteTransport(ORIGIN_WRITE_ID);
      return;
    }
    if (storedBearer() === undefined) {
      unregisterOriginWriteTransport(ORIGIN_WRITE_ID);
      return;
    }
    const transport = transportRef.current;
    if (transport === null) {
      unregisterOriginWriteTransport(ORIGIN_WRITE_ID);
      return;
    }
    registerOriginWriteTransport(ORIGIN_WRITE_ID, transport);
    return () => unregisterOriginWriteTransport(ORIGIN_WRITE_ID);
  }, [transportRef, subject.connection.kind]);

  // While any card is still Connecting, re-read get_state so a
  // missed happening cannot leave the operator guessing.
  useEffect(() => {
    if (state === null) return;
    const mounting = state.shares
      .filter((s) => states.get(s.shareId)?.state === "mounting")
      .map((s) => s.shareId);
    if (mounting.length === 0) return;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      for (const shareId of mounting) pullShareState(shareId);
    };
    tick();
    const handle = window.setInterval(tick, SHARE_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [state, states, pullShareState]);

  // Seed the events ring on connect (and reconnect). The subject is
  // delta-only, so without this read a freshly-loaded page would show
  // no history until the next live transition. list_events is
  // capability-none; the happenings above keep it live afterwards.
  useEffect(() => {
    if (subject.connection.kind !== "connected") return;
    let cancelled = false;
    void request(
      "network.share.list_events",
      {},
      decodeShareEvents,
      () => t("sources.refused")
    ).then((r) => {
      if (!cancelled && r.ok) ingestEvents(r.value.events);
    });
    return () => {
      cancelled = true;
    };
  }, [subject.connection.kind, request, ingestEvents]);

  const items: ShareItem[] | null =
    state === null
      ? null
      : state.shares.map((share) => {
          const info = states.get(share.shareId);
          return {
            ...share,
            state: info?.state ?? "unknown",
            reason: info?.reason ?? null,
            negotiated: info?.negotiated ?? null
          };
        });

  // Verbs accept extra envelope fields so the step-up gate can
  // retry them with `step_up_token` (the token rides the op payload
  // - the frame envelope itself is deny_unknown_fields).
  //
  // add / mount decode their SUCCESS body: the add verb lands even when
  // the mount it kicked off failed (prompt cancelled or timed out,
  // credential refused, host absent) and says so in `mount_error`.
  // dispatchVoid drops bodies, so it reported ok and the operator got a
  // card with no reason. These two ride `request` and map a carried
  // `mount_error` to a not-ok result the surface paints through its
  // existing error line. edit / unmount / remove keep dispatchVoid: their
  // bodies carry nothing.
  const mount = useCallback(
    async (shareId: string, extra: Record<string, unknown> = {}) => {
      const handle = window.setInterval(
        () => nudgeOriginWriteReseed(),
        ORIGIN_LIST_WHILE_WRITE_MS
      );
      nudgeOriginWriteReseed();
      try {
        return shareMountVerbResult(
          await request(
            "network.share.mount",
            { share_id: shareId, ...extra },
            decodeShareMountOutcome,
            () => t("sources.refused")
          )
        );
      } finally {
        window.clearInterval(handle);
        nudgeOriginWriteReseed();
      }
    },
    [request]
  );
  const unmount = useCallback(
    (shareId: string, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.share.unmount", { share_id: shareId, ...extra }),
    [dispatchVoid]
  );
  const remove = useCallback(
    (shareId: string, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.share.remove", { share_id: shareId, ...extra }),
    [dispatchVoid]
  );
  const add = useCallback(
    async (payload: AddSharePayload, extra: Record<string, unknown> = {}) => {
      const handle = window.setInterval(
        () => nudgeOriginWriteReseed(),
        ORIGIN_LIST_WHILE_WRITE_MS
      );
      nudgeOriginWriteReseed();
      try {
        return shareMountVerbResult(
          await request(
            "network.share.add",
            { ...payload, ...extra },
            decodeShareMountOutcome,
            () => t("sources.refused")
          )
        );
      } finally {
        window.clearInterval(handle);
        nudgeOriginWriteReseed();
      }
    },
    [request]
  );
  // network.share.edit nests the partial under `edits` (EditShareRequest
  // = { share_id, edits }); the step-up token (extra) rides at top level.
  const edit = useCallback(
    (
      shareId: string,
      edits: EditSharePayload,
      extra: Record<string, unknown> = {}
    ) => dispatchVoid("network.share.edit", { share_id: shareId, edits, ...extra }),
    [dispatchVoid]
  );

  return { connection: subject.connection, items, events, mount, unmount, remove, add, edit, reauth };
}

export interface UseDiscoveredNasState {
  connection: SubjectConnectionState;
  state: DiscoveredNasList | null;
  refresh: () => Promise<SubjectVerbResult>;
  /** Rebuild the bearer socket in place after inline pairing (see useNetworkShares). */
  reauth: () => void;
}

export function useDiscoveredNas(): UseDiscoveredNasState {
  const subject = useShelfSubject<DiscoveredNasList>({
    shelf: SHELF,
    bearerSource: storedBearer,
    readRequestType: "network.discovery.list",
    decodeRead: decodeDiscoveredNas,
    decodeHappening: decodeDiscoveredNasHappening,
    messages: MESSAGES
  });
  const { dispatchVoid, reauth } = subject;
  const refresh = useCallback(
    () => dispatchVoid("network.discovery.refresh", {}),
    [dispatchVoid]
  );
  return { connection: subject.connection, state: subject.state, refresh, reauth };
}
