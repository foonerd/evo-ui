// Domain history (chain audit log) view, hosted under
// Settings -> Activity.
//
// The chain IS the audit log per the framework substrate
// contract. This component reads the local chain via
// `domain_history` and renders one row per signed entry,
// newest first, with operator-friendly time + op + originator
// + witness-id prefix.
//
// Lives under Settings -> Activity rather than the Multi-room
// surface because audit logs are retrospective by nature and
// belong with admin / observability surfaces, not with the
// operational management surface.
//
// Opens its own WsTransport against the framework's wire-op
// surface (same URL resolution path as the multi-room hook).
// The schema-first Runtime context is not mounted in this App
// build, so useRuntime() is unavailable here. The transport
// lifecycle is owned by the component: connect on mount,
// reuse for refreshes, close on unmount. One persistent
// WebSocket per mounted view; matches the multi-room hook's
// pattern.

import { t } from "../../runtime/i18n";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import { WsTransport } from "../../runtime/ws-transport";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";

interface ChainEntry {
  id: string;
  prevHashB64: string;
  tsNs: number;
  originatorDeviceId: string;
  op: ChainOp;
}

type ChainOp =
  | { kind: "admit_peer"; deviceId: string; displayName: string }
  | { kind: "discard_peer"; deviceId: string; reason: string | null }
  | { kind: "move_member"; deviceId: string; fromGroupId: string; toGroupId: string }
  | { kind: "set_group_leader"; groupId: string; leaderDeviceId: string }
  | { kind: "other"; raw: Record<string, unknown> };

interface DomainMember {
  deviceId: string;
  displayName: string;
}

/** One observed peer-presence transition. The presence feed is a
 *  live session log - it starts empty and fills as
 *  peer_presence_changed happenings arrive. */
interface PresenceTransition {
  key: string;
  deviceId: string;
  oldState: string;
  newState: string;
  atMs: number;
}

/** Newest-first cap on the in-session presence feed. */
const PRESENCE_FEED_MAX = 60;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; entries: ChainEntry[]; members: DomainMember[] }
  | { kind: "error"; message: string };

export function DomainHistoryView() {
  const transportRef = useRef<WsTransport | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [presence, setPresence] = useState<PresenceTransition[]>([]);

  const fetchOnce = async (transport: WsTransport): Promise<void> => {
    try {
      const [hist, roster] = await Promise.all([
        transport.dispatch("domain_history", { limit: 200 }),
        transport.dispatch("list_domain_members", {})
      ]);
      if (hist.error !== undefined) {
        setState({ kind: "error", message: hist.error.message ?? "domain_history failed" });
        return;
      }
      const entries = decodeChainEntries(hist.value);
      const members = roster.error !== undefined ? [] : decodeRoster(roster.value);
      setState({ kind: "ready", entries, members });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ kind: "error", message: msg });
    }
  };

  const refresh = async (): Promise<void> => {
    if (transportRef.current === null) return;
    setBusy(true);
    await fetchOnce(transportRef.current);
    setBusy(false);
  };

  useEffect(() => {
    const url = resolveFrameworkUrl();
    const transport = new WsTransport({ url });
    transportRef.current = transport;
    let cancelled = false;
    const handleHappening = (raw: unknown): void => {
      if (cancelled) return;
      const t = decodePresenceTransition(raw);
      if (t === null) return;
      setPresence((prev) => [t, ...prev].slice(0, PRESENCE_FEED_MAX));
    };
    const abort = new AbortController();
    const run = async (): Promise<void> => {
      try {
        await transport.connect();
        if (cancelled) return;
        await fetchOnce(transport);
        if (cancelled) return;
        // The presence feed rides the happenings stream - the same
        // peer_presence_changed events the multi-room substrate
        // emits. No read is needed; the feed accrues live.
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: abort.signal }
          );
          try {
            for await (const ev of stream) {
              if (cancelled) return;
              handleHappening(ev);
            }
          } catch {
            // Subscription ended; component unmount / reconnect.
          }
        })();
        transport.onHappening((f) => handleHappening(f.happening));
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message: msg });
      }
    };
    void run();
    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
    };
  }, []);

  const resolveName = useMemo(() => {
    const members = state.kind === "ready" ? state.members : [];
    const byId = new Map<string, string>();
    for (const m of members) byId.set(m.deviceId, m.displayName);
    return (deviceId: string): string =>
      byId.get(deviceId) ?? deviceId.slice(0, 8);
  }, [state]);

  // Newest-first ordering. The framework returns entries in
  // chain order (oldest first); reverse for operator UX so
  // the latest gesture sits at the top.
  const ordered = useMemo(() => {
    if (state.kind !== "ready") return null;
    return [...state.entries].reverse();
  }, [state]);

  return (
    <div className="activity-history">
      <div className="activity-history-head">
        <div>
          <p className="settings-row-description">
            Live device presence, and the signed chain audit log.
          </p>
        </div>
        <button
          type="button"
          className="activity-history-refresh"
          onClick={() => void refresh()}
          disabled={busy || state.kind === "loading"}
        >
          <RefreshCw size={14} />
          <span>{busy || state.kind === "loading" ? t("activity.loading") : t("activity.refresh")}</span>
        </button>
      </div>

      <p className="activity-section-title">{t("activity.presence")}</p>
      {presence.length === 0 ? (
        <p className="activity-history-empty">
          No device presence changes observed yet this session - they
          appear here live as devices transition.
        </p>
      ) : (
        <ol className="activity-presence-list">
          {presence.map((t) => (
            <li key={t.key} className="activity-presence-entry">
              <span className="activity-history-time">
                {renderClockMs(t.atMs)}
              </span>
              <span className="activity-presence-device">
                {resolveName(t.deviceId)}
              </span>
              <span className="activity-presence-shift">
                <span
                  className={`activity-presence-state activity-presence-${t.oldState}`}
                >
                  {t.oldState || "?"}
                </span>
                <span aria-hidden> -&gt; </span>
                <span
                  className={`activity-presence-state activity-presence-${t.newState}`}
                >
                  {t.newState || "?"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="activity-section-title">{t("activity.domainHistory")}</p>
      {state.kind === "loading" ? (
        <p className="activity-history-empty">{t("activity.loadingChain")}</p>
      ) : state.kind === "error" ? (
        <p className="activity-history-empty">
          {t("activity.chainError", { message: state.message })}
        </p>
      ) : ordered === null || ordered.length === 0 ? (
        <p className="activity-history-empty">
          The chain is empty on this device. The substrate may not be
          live yet.
        </p>
      ) : (
        <ol className="activity-history-list">
          {ordered.map((entry) => (
            <li key={entry.id} className="activity-history-entry">
              <div className="activity-history-time">
                {renderWallClock(entry.tsNs)}
              </div>
              <div className="activity-history-op">
                {renderChainOp(entry, resolveName)}
              </div>
              <div className="activity-history-meta">
                <span className="activity-history-originator">
                  by {resolveName(entry.originatorDeviceId)}
                </span>
                <span className="activity-history-witness">
                  witness {entry.id.slice(0, 8)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function resolveFrameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) {
    return override;
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

function renderWallClock(tsNs: number): string {
  const d = new Date(Math.floor(tsNs / 1_000_000));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "short" });
  return `${hh}:${mm}:${ss} (${day} ${month})`;
}

/** Wall-clock string from a millisecond epoch. */
function renderClockMs(ms: number): string {
  return renderWallClock(ms * 1_000_000);
}

let presenceKeySeq = 0;

/** Decode a peer_presence_changed happening into a feed entry, or
 *  null when the frame is not one. Unwraps a { happening: ... }
 *  envelope; decodes the SystemTime `at` to a ms epoch, falling
 *  back to receipt time. */
function decodePresenceTransition(raw: unknown): PresenceTransition | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"])
    ? (raw["happening"] as Record<string, unknown>)
    : raw;
  if (frame["type"] !== "peer_presence_changed") return null;
  const deviceId = stringField(frame, "peer_device_id");
  if (deviceId === null) return null;
  let atMs = Date.now();
  const at = frame["at"];
  if (isObject(at)) {
    const secs = numberField(at, "secs_since_epoch");
    if (secs !== null) {
      atMs =
        secs * 1000 +
        Math.floor((numberField(at, "nanos_since_epoch") ?? 0) / 1_000_000);
    }
  }
  presenceKeySeq += 1;
  return {
    key: `${deviceId}:${atMs}:${presenceKeySeq}`,
    deviceId,
    oldState: stringField(frame, "old_state") ?? "",
    newState: stringField(frame, "new_state") ?? "",
    atMs
  };
}

function renderChainOp(
  entry: ChainEntry,
  resolveName: (id: string) => string
): string {
  const op = entry.op;
  switch (op.kind) {
    case "admit_peer":
      return t("activity.admitted", { name: op.displayName.length > 0 ? op.displayName : resolveName(op.deviceId) });
    case "discard_peer":
      return t("activity.discarded", { name: resolveName(op.deviceId) }) + (op.reason !== null && op.reason.length > 0 ? ` (${op.reason})` : "");
    case "move_member":
      return t("activity.moved", { name: resolveName(op.deviceId) });
    case "set_group_leader":
      return t("activity.setLeader", { name: resolveName(op.leaderDeviceId) });
    case "other":
      return stringField(op.raw, "kind") ?? t("activity.chainEntry");
  }
}

function decodeChainEntries(raw: unknown): ChainEntry[] {
  if (!isObject(raw)) return [];
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return [];
  const out: ChainEntry[] = [];
  for (const e of entries) {
    if (!isObject(e)) continue;
    const id = stringField(e, "id");
    const prevHashB64 = stringField(e, "prev_hash_b64");
    const tsNs = numberField(e, "ts_ns");
    const originatorDeviceId = stringField(e, "originator_device_id");
    if (id === null || prevHashB64 === null || tsNs === null || originatorDeviceId === null) {
      continue;
    }
    out.push({ id, prevHashB64, tsNs, originatorDeviceId, op: decodeChainOp(e["op"]) });
  }
  return out;
}

function decodeChainOp(raw: unknown): ChainOp {
  if (!isObject(raw)) return { kind: "other", raw: {} };
  const kind = stringField(raw, "kind");
  if (kind === "admit_peer") {
    return {
      kind: "admit_peer",
      deviceId: stringField(raw, "device_id") ?? "",
      displayName: stringField(raw, "display_name") ?? ""
    };
  }
  if (kind === "discard_peer") {
    return {
      kind: "discard_peer",
      deviceId: stringField(raw, "device_id") ?? "",
      reason: stringField(raw, "reason")
    };
  }
  if (kind === "move_member") {
    return {
      kind: "move_member",
      deviceId: stringField(raw, "device_id") ?? "",
      fromGroupId: stringField(raw, "from_group_id") ?? "",
      toGroupId: stringField(raw, "to_group_id") ?? ""
    };
  }
  if (kind === "set_group_leader") {
    return {
      kind: "set_group_leader",
      groupId: stringField(raw, "group_id") ?? "",
      leaderDeviceId: stringField(raw, "leader_device_id") ?? ""
    };
  }
  return { kind: "other", raw };
}

function decodeRoster(raw: unknown): DomainMember[] {
  if (!isObject(raw)) return [];
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return [];
  const out: DomainMember[] = [];
  for (const e of entries) {
    if (!isObject(e)) continue;
    const deviceId = stringField(e, "device_id");
    const displayName = stringField(e, "display_name");
    if (deviceId === null) continue;
    out.push({ deviceId, displayName: displayName ?? deviceId.slice(0, 8) });
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}
