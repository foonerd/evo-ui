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
  type ConfiguredShares,
  type DiscoveredNasList,
  type ShareRecord,
  type ShareStateInfo,
  type ShareEventItem
} from "./share-decoders";

const SHELF = "networking.shares";

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
    bearerToken: storedBearer(),
    readRequestType: "network.share.list_configured",
    decodeRead: decodeConfiguredShares,
    decodeHappening: decodeConfiguredSharesHappening,
    messages: MESSAGES
  });
  const { state, request, dispatchVoid, transportRef, reauth } = subject;
  const [states, setStates] = useState<ReadonlyMap<string, ShareStateInfo>>(new Map());
  const [events, setEvents] = useState<ShareEventItem[]>([]);
  const fetchedFor = useRef<string>("");

  // Fetch per-share state whenever the share set changes.
  useEffect(() => {
    if (state === null) return;
    const key = state.shares.map((s) => s.shareId).sort().join(",");
    if (key === fetchedFor.current) return;
    fetchedFor.current = key;
    for (const share of state.shares) {
      void request(
        "network.share.get_state",
        { share_id: share.shareId },
        decodeShareState,
        () => t("sources.refused")
      ).then((r) => {
        if (r.ok) {
          setStates((prev) => new Map(prev).set(r.value.shareId, r.value));
        }
      });
    }
  }, [state, request]);

  // Fold per-share state happenings into the map, and the
  // network_share_events ring (seed announce + updates) into the list.
  // The events subject re-announces the whole ring each change, so we
  // replace rather than append.
  useEffect(() => {
    const transport = transportRef.current;
    if (transport === null) return;
    return transport.onHappening((f) => {
      const info = decodeShareStateHappening(f.happening);
      if (info !== null) {
        setStates((prev) => new Map(prev).set(info.shareId, info));
        return;
      }
      const ev = decodeShareEventsHappening(f.happening);
      if (ev !== null) setEvents(ev.events);
    });
  }, [transportRef, state]);

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
      if (!cancelled && r.ok) setEvents(r.value.events);
    });
    return () => {
      cancelled = true;
    };
  }, [subject.connection.kind, request]);

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
  const mount = useCallback(
    (shareId: string, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.share.mount", { share_id: shareId, ...extra }),
    [dispatchVoid]
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
    (payload: AddSharePayload, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.share.add", { ...payload, ...extra }),
    [dispatchVoid]
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
    bearerToken: storedBearer(),
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
