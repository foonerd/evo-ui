// HouseholdModalHost - the ONE onboarding host + first-paint gate + the
// opener the Settings door (and any scope-locked surface) calls.
//
// Mounted once inside PlayerShellProviders so it shares the framework
// transport. It runs useHouseholdProtection() once (one get, one
// subscription) and forces the fresh-start onboarding SEQUENCE with the
// player chrome live underneath:
//   step 1 (browser only, no bearer): pair - the existing PairDeviceFlow,
//     in-surface via onPaired so it never full-page-reloads past usage.
//   step 2 (glass and browser): the one household usage modal, forced
//     non-dismissible until the operator chooses a level.
// Glass skips step 1 (the kiosk already minted a local bearer); a browser
// that already holds a bearer skips it too. Which step is firstPaintStep's
// call, not this host's - the host only supplies the live signals. This host
// reuses the two existing ceremonies; it builds no second pair and no second
// household, and the usage step never mints a bearer.
//
// Designer / tests have no transport -> ready:false, snapshot stays null,
// the gate never fires and the door hides itself. Real sessions get the
// sequence + door.

import { createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import {
  useHouseholdProtection,
  type HouseholdProtection
} from "./useHouseholdProtection";
import { HouseholdModal } from "./HouseholdModal";
import { firstPaintStep } from "./household-protection";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { storedBearer } from "../../runtime/bearer";
import { kioskMode } from "../kiosk/kiosk-bridge";

export interface HouseholdModalContextValue {
  /** Open the household modal (dismissible). */
  open: () => void;
  /** True while the player is lent (settings locked, playback unaffected). */
  lent: boolean;
  /** Live household state, for surfaces that show the current level or the
   *  locked copy. */
  household: HouseholdProtection;
}

const HouseholdModalContext = createContext<HouseholdModalContextValue | null>(
  null
);

/** Null outside the provider (designer / isolated tests) - callers hide the
 *  affordance rather than render a dead one. */
export function useHouseholdModal(): HouseholdModalContextValue | null {
  return useContext(HouseholdModalContext);
}

export function HouseholdModalProvider({
  children
}: {
  children: ComponentChildren;
}): JSX.Element {
  const hh = useHouseholdProtection();
  const [manualOpen, setManualOpen] = useState(false);
  // Browser pairing state. Seeded from the stored bearer; flipped true when
  // step-1 pair completes IN-SURFACE (onPaired, no reload) so the sequence
  // advances to step 2 rather than reloading past it. Glass never needs this
  // (it skips step 1 regardless).
  const [hasBearer, setHasBearer] = useState(() => storedBearer() !== undefined);
  const isGlass = kioskMode() === "glass";
  const open = useCallback(() => setManualOpen(true), []);
  const close = useCallback(() => setManualOpen(false), []);
  const onPaired = useCallback(() => setHasBearer(true), []);

  const snap = hh.snapshot;
  // The gate decides the step from the live signals; the host does not
  // re-derive it. Until the get resolves, snapshot is null and step is
  // "none" (no fabricated default).
  const step = firstPaintStep({
    ready: hh.ready,
    snapshot: snap,
    hasBearer,
    isGlass
  });
  const showPair = step === "pair";
  // Usage shows on first paint (forced) or when the Settings door opened it
  // (dismissible). snap !== null is implied by step === "usage" but kept for
  // the manual path.
  const showUsage = (step === "usage" || manualOpen) && snap !== null;
  const dismissible = step !== "usage";

  const ctx = useMemo<HouseholdModalContextValue>(
    () => ({ open, lent: snap?.lend === true, household: hh }),
    [open, snap, hh]
  );

  return (
    <HouseholdModalContext.Provider value={ctx}>
      {children}
      {showPair ? (
        // Step 1, browser only: FORCED pair - no Cancel, no ESC / backdrop /
        // close. onPaired advances to step 2 without a reload.
        <PairDeviceFlow forced onPaired={onPaired} />
      ) : null}
      {showUsage ? (
        <HouseholdModal hh={hh} dismissible={dismissible} onClose={close} />
      ) : null}
    </HouseholdModalContext.Provider>
  );
}
