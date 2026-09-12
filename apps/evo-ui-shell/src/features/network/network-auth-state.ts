// Pure reducer for the Network surface's "pair to manage" prompt
// (authNeeded). Extracted so the pair -> clear contract is unit-tested
// without rendering the hook (useNetworkLink pulls in the framework
// transport, which the node:test harness can't load).

export type NetAuthEvent =
  // A mutation was attempted with no stored operator bearer.
  | { kind: "no_bearer" }
  // A mutation returned; pairRequired is the shared classifier's verdict.
  | { kind: "verb_result"; pairRequired: boolean }
  // Inline pairing completed (onPaired -> reauth). The device is now
  // paired, so the prompt MUST clear - this is the fix for the banner that
  // stuck after pair_authenticate succeeded.
  | { kind: "reauth" };

/** Next value of the authNeeded flag. reauth ALWAYS clears it so the
 *  "isn't paired for network management" banner never sticks after a
 *  successful pair; a later refused mutation re-raises it honestly. */
export function nextAuthNeeded(ev: NetAuthEvent): boolean {
  switch (ev.kind) {
    case "no_bearer":
      return true;
    case "verb_result":
      return ev.pairRequired;
    case "reauth":
      return false;
  }
}
