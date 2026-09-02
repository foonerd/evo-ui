// smb-server-decoders - wire shapes for the SMB-server verbs on the
// networking.shares shelf (device's own file server, distinct from the
// share-consumer side in share-decoders).
//
//   network.smb_server.get_state -> SystemSmbServerEnvelope
//   system_smb_server subject     -> same envelope
//   { enabled, min_protocol, extra_shares:[{name,path,guest_ok}],
//     smb_users:[{username, mapped_domain_identity, created_at_ms}],
//     last_apply_at_ms, last_update_at }
// Passwords never ride the wire: user_add carries a credential_key the
// device resolves from the vault (prompt-on-apply).

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  return isObject(raw["envelope"]) ? (raw["envelope"] as Record<string, unknown>) : raw;
}

export interface SmbUser {
  username: string;
  mappedDomainIdentity: string | null;
  createdAtMs: number | null;
}

export interface SmbExtraShare {
  name: string;
  path: string;
  guestOk: boolean;
}

export interface SmbServerInfo {
  enabled: boolean;
  /** Wire form: "default" | "smb2_02" | "smb3_02". */
  minProtocol: string;
  extraShares: SmbExtraShare[];
  users: SmbUser[];
  lastApplyAtMs: number | null;
  /** Current OS hostname / SMB netbios name, when the device exposes it
   *  on the envelope; null otherwise (device pre-dates the field). */
  hostname: string | null;
}

function decodeUser(raw: unknown): SmbUser | null {
  if (!isObject(raw)) return null;
  const username = str(raw, "username");
  if (username === null) return null;
  return {
    username,
    mappedDomainIdentity: str(raw, "mapped_domain_identity"),
    createdAtMs: num(raw, "created_at_ms")
  };
}

function decodeExtraShare(raw: unknown): SmbExtraShare | null {
  if (!isObject(raw)) return null;
  const name = str(raw, "name");
  const path = str(raw, "path");
  if (name === null || path === null) return null;
  return { name, path, guestOk: raw["guest_ok"] === true };
}

export function decodeSmbServer(raw: unknown): SmbServerInfo | null {
  const b = unwrap(raw);
  if (b === null || typeof b["enabled"] !== "boolean") return null;
  const users: SmbUser[] = [];
  if (Array.isArray(b["smb_users"])) {
    for (const u of b["smb_users"]) {
      const d = decodeUser(u);
      if (d !== null) users.push(d);
    }
  }
  const extraShares: SmbExtraShare[] = [];
  if (Array.isArray(b["extra_shares"])) {
    for (const s of b["extra_shares"]) {
      const d = decodeExtraShare(s);
      if (d !== null) extraShares.push(d);
    }
  }
  return {
    enabled: b["enabled"] === true,
    minProtocol: str(b, "min_protocol") ?? "default",
    extraShares,
    users,
    lastApplyAtMs: num(b, "last_apply_at_ms"),
    hostname: str(b, "hostname") ?? str(b, "system_hostname") ?? str(b, "netbios_name")
  };
}

export function decodeSmbServerHappening(raw: unknown): SmbServerInfo | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "system_smb_server") return null;
  return decodeSmbServer(frame["new_state"]);
}
