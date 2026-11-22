// power-write-socket - which socket a reboot / power-off verb rides.
//
// useSystemPower opens a private anonymous seed socket for its reads
// (list_plugins, the flight-mode read). reboot_device and
// power_off_device used to go out on it too. Both verbs gate at
// write:system_admin, with the household policy as the door on top.
// After this browser pairs, a sitting the owner proves is bound to
// bearer:<id>; while the household protects system_admin, a verb that
// stays on the anonymous seed socket presents that sitting from the
// LAN-trust identity, the household door refuses it as another
// caller's (household_policy_locked), and the sitting can never
// satisfy it.
//
// Same rule as the kiosk, household, Audio and Metadata write sockets:
// with a stored bearer, the verbs ride a private socket that presents
// it (read at every handshake, rotated by the bearer bus, closed on
// unmount); without one, they stay on the seed socket. The reads stay
// on the seed socket either way, and the seed socket is never given a
// bearer. The Flight write keeps its own socket on a different shelf.

export type PowerWriteSocket = "seed" | "stored-bearer";

export function powerWriteSocket(hasStoredBearer: boolean): PowerWriteSocket {
  return hasStoredBearer ? "stored-bearer" : "seed";
}
