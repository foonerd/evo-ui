// useSmbServer - the device's own SMB file server (networking.shares
// shelf, smb_server.* verbs). get_state is capability-none; apply /
// user_add / user_revoke are step-up gated on network_admin, so they
// ride the paired bearer (inline pairing mints it) exactly like the
// share-consumer mutations. Passwords never ride the wire - user_add
// carries a credential_key the device resolves from the vault.

import { useCallback } from "preact/hooks";
import {
  useShelfSubject,
  type SubjectConnectionState,
  type SubjectVerbResult
} from "../../runtime/use-shelf-subject";
import { storedBearer } from "../../runtime/bearer";
import { t } from "../../runtime/i18n";
import {
  decodeSmbServer,
  decodeSmbServerHappening,
  type SmbExtraShare,
  type SmbServerInfo
} from "./smb-server-decoders";

const SHELF = "networking.shares";

const MESSAGES = {
  wsUnavailable: () => t("collection.wsUnavailable"),
  notConnected: () => t("sources.notConnected"),
  noResponse: (n: number, detail: string) => t("sources.noResponse", { n, detail }),
  refused: () => t("sources.refused")
};

export interface SmbServerApply {
  enabled: boolean;
  /** "default" | "smb2_02" | "smb3_02". */
  min_protocol: string;
  /** Full replacement of the extra-shares list. */
  extra_shares: { name: string; path: string; guest_ok: boolean }[];
  /** Optional OS hostname change applied in the same gesture. */
  system_hostname?: string;
}

export interface UseSmbServerState {
  connection: SubjectConnectionState;
  /** null until the first read lands. */
  state: SmbServerInfo | null;
  apply: (req: SmbServerApply, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  addUser: (
    username: string,
    credentialKey: string,
    mappedDomain?: string,
    extra?: Record<string, unknown>
  ) => Promise<SubjectVerbResult>;
  revokeUser: (username: string, extra?: Record<string, unknown>) => Promise<SubjectVerbResult>;
  /** Rebuild the bearer socket after inline pairing (network_admin). */
  reauth: () => void;
}

/** Map a decoded extra share back to the wire (guest_ok) shape. */
export function extraShareToWire(s: SmbExtraShare): {
  name: string;
  path: string;
  guest_ok: boolean;
} {
  return { name: s.name, path: s.path, guest_ok: s.guestOk };
}

export function useSmbServer(): UseSmbServerState {
  const subject = useShelfSubject<SmbServerInfo>({
    shelf: SHELF,
    bearerToken: storedBearer(),
    readRequestType: "network.smb_server.get_state",
    decodeRead: decodeSmbServer,
    decodeHappening: decodeSmbServerHappening,
    messages: MESSAGES
  });
  const { dispatchVoid, reauth } = subject;

  const apply = useCallback(
    (req: SmbServerApply, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.smb_server.apply", { ...req, ...extra }),
    [dispatchVoid]
  );
  const addUser = useCallback(
    (
      username: string,
      credentialKey: string,
      mappedDomain?: string,
      extra: Record<string, unknown> = {}
    ) =>
      dispatchVoid("network.smb_server.user_add", {
        username,
        credential_key: credentialKey,
        ...(mappedDomain !== undefined && mappedDomain.length > 0
          ? { mapped_domain_identity: mappedDomain }
          : {}),
        ...extra
      }),
    [dispatchVoid]
  );
  const revokeUser = useCallback(
    (username: string, extra: Record<string, unknown> = {}) =>
      dispatchVoid("network.smb_server.user_revoke", { username, ...extra }),
    [dispatchVoid]
  );

  return {
    connection: subject.connection,
    state: subject.state,
    apply,
    addUser,
    revokeUser,
    reauth
  };
}
