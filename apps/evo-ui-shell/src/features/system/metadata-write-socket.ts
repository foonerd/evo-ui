// metadata-write-socket - which socket a Settings > Metadata write rides.
//
// The two Metadata hooks (useCredentials, useProviders) list on the
// page-lifetime shared LAN-trust socket, which is never given a token.
// Every mutation (credential_put / credential_delete /
// online_providers_set_*) used to go out on it too. After this browser
// pairs, its sitting and its write scope live on bearer:<id>; a write
// that stays on the shared socket presents that sitting from the
// LAN-trust identity, so a household policy protecting Metadata refuses
// it (household_policy_locked) and the card can never satisfy.
//
// Same rule as the kiosk, household and Audio write sockets: with a
// stored bearer, writes ride a private socket that presents it (read
// at every handshake, rotated by the bearer bus, closed on unmount);
// without one, they stay on the shared socket. The lists stay on the
// shared socket either way, and the shared socket is never given a
// bearer - a stale bearer on the read path blacks a panel out.

export type MetadataWriteSocket = "shared" | "stored-bearer";

export function metadataWriteSocket(hasStoredBearer: boolean): MetadataWriteSocket {
  return hasStoredBearer ? "stored-bearer" : "shared";
}
