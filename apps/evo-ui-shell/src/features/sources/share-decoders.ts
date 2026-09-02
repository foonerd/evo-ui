// share-decoders - wire shapes for the networking.shares shelf
// (Phase 3b, read side).
//
// Envelope wrappers verified LIVE (2026-07-18, empty lists):
//   network.share.list_configured ->
//     { envelope: { shares: [...], last_update_at } }
//   network.discovery.list ->
//     { envelope: { nas: [...], last_refresh_at } }
//
// Record shapes verified against LIVE records (2026-07-18, probe
// share created + captured + removed on the bench):
//   share record: { share_id, alias, fstype, host, path,
//     credentials: { kind: "guest"|"user_password"|"key_file",
//     username? }, advanced_options, persisted_vers, mount_root,
//     created_at_ms, last_mounted_at_ms }
//   network.share.get_state -> { envelope: { share_id, alias,
//     state, reason, negotiated_vers, last_transition_at_ms } }
//   network.share.add response: { share_id, mount_report,
//     mount_error }
// State does NOT live on the configured record - it rides the
// per-share state envelope; the surface merges the two.

export type ShareFsType = "cifs" | "nfs" | "unknown";

export type ShareState =
  | "mounted"
  | "unmounted"
  | "mounting"
  | "failed"
  | "unknown";

export interface ShareRecord {
  shareId: string;
  alias: string;
  host: string;
  path: string;
  fstype: ShareFsType;
  credentialsKind: string;
  /** Username on a user_password credential (never the secret). */
  username: string | null;
  /** AD workgroup / domain on a user_password credential. */
  domain: string | null;
  /** Extra mount options (e.g. vers=2.0,noserverino) appended after the
   *  framework defaults; empty string = none. */
  advancedOptions: string;
  mountRoot: string | null;
  persistedVers: string | null;
}

/** Per-share live state from network.share.get_state / the
 *  network_share_state subject. */
export interface ShareStateInfo {
  shareId: string;
  state: ShareState;
  reason: string | null;
  negotiated: string | null;
}

export interface ConfiguredShares {
  shares: ShareRecord[];
}

export interface DiscoveredNas {
  name: string;
  host: string;
  dialect: string | null;
  shares: string[];
  alreadyConfigured: boolean;
}

export interface DiscoveredNasList {
  nas: DiscoveredNas[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(rec: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function decodeFsType(raw: unknown): ShareFsType {
  return raw === "cifs" || raw === "nfs" ? raw : "unknown";
}

function decodeState(raw: unknown): ShareState {
  return raw === "mounted" || raw === "unmounted" || raw === "mounting" || raw === "failed"
    ? raw
    : "unknown";
}

function decodeShare(raw: unknown): ShareRecord | null {
  if (!isObject(raw)) return null;
  const shareId = str(raw, "share_id");
  const alias = str(raw, "alias");
  const host = str(raw, "host");
  if (shareId === null || alias === null || host === null) return null;
  const creds = raw["credentials"];
  const credsObj = isObject(creds) ? creds : null;
  return {
    shareId,
    alias,
    host,
    path: str(raw, "path") ?? "",
    fstype: decodeFsType(raw["fstype"]),
    credentialsKind: (credsObj !== null ? str(credsObj, "kind") : null) ?? "guest",
    username: credsObj !== null ? str(credsObj, "username") : null,
    domain: credsObj !== null ? str(credsObj, "domain") : null,
    advancedOptions: str(raw, "advanced_options") ?? "",
    mountRoot: str(raw, "mount_root"),
    persistedVers: str(raw, "persisted_vers")
  };
}

/** Decode the network.share.get_state response envelope or the
 *  network_share_state subject body. */
export function decodeShareState(raw: unknown): ShareStateInfo | null {
  const b = body(raw);
  if (b === null) return null;
  const shareId = str(b, "share_id");
  if (shareId === null) return null;
  return {
    shareId,
    state: decodeState(b["state"]),
    reason: str(b, "reason"),
    negotiated: str(b, "negotiated_vers")
  };
}

/** Decode a per-share state happening. */
export function decodeShareStateHappening(raw: unknown): ShareStateInfo | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "network_share_state") return null;
  return decodeShareState(frame["new_state"]);
}

function body(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  return isObject(raw["envelope"]) ? (raw["envelope"] as Record<string, unknown>) : raw;
}

export function decodeConfiguredShares(raw: unknown): ConfiguredShares | null {
  const b = body(raw);
  if (b === null || !Array.isArray(b["shares"])) return null;
  const shares: ShareRecord[] = [];
  for (const entry of b["shares"]) {
    const share = decodeShare(entry);
    if (share !== null) shares.push(share);
  }
  return { shares };
}

export function decodeConfiguredSharesHappening(raw: unknown): ConfiguredShares | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "system_network_shares_configured") return null;
  return decodeConfiguredShares(frame["new_state"]);
}

function decodeNas(raw: unknown): DiscoveredNas | null {
  if (!isObject(raw)) return null;
  const name = str(raw, "name", "netbios_name", "mdns_name");
  const host = str(raw, "host", "ip", "address");
  if (name === null && host === null) return null;
  // Live wire shape: shares is a list of { name, comment } records
  // (string entries tolerated for forward compatibility).
  const sharesRaw = raw["shares"];
  const shares: string[] = [];
  if (Array.isArray(sharesRaw)) {
    for (const entry of sharesRaw) {
      if (typeof entry === "string" && entry.length > 0) {
        shares.push(entry);
      } else if (isObject(entry)) {
        const n = str(entry, "name");
        if (n !== null) shares.push(n);
      }
    }
  }
  return {
    name: name ?? host ?? "",
    host: host ?? "",
    dialect: str(raw, "advertised_dialect", "negotiated_dialect", "dialect"),
    shares,
    alreadyConfigured: raw["already_configured"] === true
  };
}

export function decodeDiscoveredNas(raw: unknown): DiscoveredNasList | null {
  const b = body(raw);
  if (b === null || !Array.isArray(b["nas"])) return null;
  const nas: DiscoveredNas[] = [];
  for (const entry of b["nas"]) {
    const item = decodeNas(entry);
    if (item !== null) nas.push(item);
  }
  return { nas };
}

export function decodeDiscoveredNasHappening(raw: unknown): DiscoveredNasList | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "system_network_shares_discovered") return null;
  return decodeDiscoveredNas(frame["new_state"]);
}

/** One entry from the network_share_events ring. `kind` is one of
 *  mounted / mount_failed / unmounted / unmount_failed. */
export type ShareEventKind =
  | "mounted"
  | "mount_failed"
  | "unmounted"
  | "unmount_failed";

export interface ShareEventItem {
  shareId: string;
  kind: ShareEventKind;
  /** Failure reason on *_failed events; null otherwise. */
  detail: string | null;
  negotiatedVersion: string | null;
  atMs: number;
}

export interface ShareEventsList {
  events: ShareEventItem[];
}

function decodeEventKind(raw: unknown): ShareEventKind | null {
  return raw === "mounted" ||
    raw === "mount_failed" ||
    raw === "unmounted" ||
    raw === "unmount_failed"
    ? raw
    : null;
}

/** Decode the network_share_events subject envelope ({ events: [...] }). */
export function decodeShareEvents(raw: unknown): ShareEventsList | null {
  const b = body(raw);
  if (b === null || !Array.isArray(b["events"])) return null;
  const events: ShareEventItem[] = [];
  for (const entry of b["events"]) {
    if (!isObject(entry)) continue;
    const shareId = str(entry, "share_id");
    const kind = decodeEventKind(entry["kind"]);
    const atMsRaw = entry["at_ms"];
    if (shareId === null || kind === null || typeof atMsRaw !== "number") continue;
    events.push({
      shareId,
      kind,
      detail: str(entry, "detail"),
      negotiatedVersion: str(entry, "negotiated_version"),
      atMs: atMsRaw
    });
  }
  return { events };
}

/** Decode a network_share_events subject happening (seed announce + updates). */
export function decodeShareEventsHappening(raw: unknown): ShareEventsList | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "network_share_events") return null;
  return decodeShareEvents(frame["new_state"]);
}
