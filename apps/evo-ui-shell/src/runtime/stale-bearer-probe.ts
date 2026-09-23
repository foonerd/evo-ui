// stale-bearer-probe - run the stale-bearer policy once, on demand.
//
// A bearer socket that will not (re)open cannot tell whether the token
// is dead or the device is down: the framework refuses a dead bearer at
// the HTTP upgrade and the browser reports both as WS close 1006. The
// only honest discriminator is an anonymous read that lands. This helper
// opens a PRIVATE anonymous socket, asks the caller's read, closes the
// socket, and applies the decision table in stale-bearer-policy.ts:
//
//   anon connect fails            -> "device-down"  keep the token
//   anon connected, read refused  -> "backout"      keep the token
//   anon connected, read landed   -> "purge"        the token is dead;
//                                    clearBearer() announces it on the
//                                    bearer bus so every live bearer
//                                    socket re-handshakes anonymously
//
// Never purges on an outage: purge needs a landed read. The shared
// page-lifetime transport is never touched.

import { WsTransport } from "./ws-transport.ts";
import { connectWithRetry, type ConnectRetryOpts } from "./connect-retry.ts";
import { clearBearer } from "./bearer.ts";
import { resolveReconnectEpisode } from "./bearer-handshake.ts";

export type StaleBearerProbeOutcome =
  | "purge"
  | "device-down"
  | "backout"
  | "cancelled";

export interface StaleBearerProbeOpts {
  url: string;
  /** A capability-none read on the anonymous socket. Resolve true when
   *  it LANDED (a clean, non-refused response), false when refused. */
  read: (transport: WsTransport) => Promise<boolean>;
  isCancelled: () => boolean;
  /** Connect budget for the anonymous probe socket. Defaults to the
   *  standard bounded retry; the contract harness shortens it. */
  connect?: ConnectRetryOpts;
}

export async function probeStaleBearer(
  opts: StaleBearerProbeOpts
): Promise<StaleBearerProbeOutcome> {
  const anon = new WsTransport({ url: opts.url });
  let anonConnected = false;
  let anonReadLanded = false;
  try {
    await connectWithRetry(anon, () => undefined, opts.isCancelled, opts.connect);
    if (opts.isCancelled()) return "cancelled";
    anonConnected = anon.isOpen();
    if (anonConnected) {
      anonReadLanded = await opts.read(anon);
    }
  } catch {
    anonConnected = false;
  } finally {
    void anon.close();
  }
  if (opts.isCancelled()) return "cancelled";
  const outcome = resolveReconnectEpisode({
    hadStoredBearer: true,
    anonConnected,
    anonReadLanded
  });
  switch (outcome) {
    case "purge-and-retry-anonymous":
      clearBearer();
      return "purge";
    case "keep-token-not-connected":
      return "device-down";
    case "backout-keep-token":
      return "backout";
    case "no-bearer":
      return "device-down";
  }
}
