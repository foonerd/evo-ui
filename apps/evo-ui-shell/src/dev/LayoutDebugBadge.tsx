import { usePresentationPlan } from "../runtime/presentation-context";
import { readViewport } from "../runtime/presentation-target";

/** Corner readout for on-device layout testing (`?layout-debug=1`). */
export function LayoutDebugBadge() {
  const plan = usePresentationPlan();
  const viewport = readViewport();

  return (
    <div className="layout-debug-badge" aria-live="polite">
      <strong>Layout debug</strong>
      <span>
        {viewport.widthPx}×{viewport.heightPx}
      </span>
      <span>fold: {plan.foldTier}</span>
      <span>class: {plan.sizeClass}</span>
      <span>kind: {plan.deviceKind}</span>
      <span>mode: {plan.interaction}</span>
      {plan.is7kOverlay ? <span>7K</span> : null}
    </div>
  );
}

export function isLayoutDebugMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get("layout-debug") === "1";
}
