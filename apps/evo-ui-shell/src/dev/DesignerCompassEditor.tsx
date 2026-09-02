// Compass curation - the second studio. The compact-panel compass
// (four swipes + centre tap) becomes curated data instead of fixed
// wiring: an OUTLINE of gesture cards in the v7 builder chrome, each
// opening a SETTINGS page where the operator assigns one of the
// curated reveals or turns the gesture off. The landing choice
// (compass home vs track home) lives here too - it is the same
// surface's behaviour. Writes go through mergeProfileForTarget
// (per-target, custom fallback) beside smallLanding; the embedded
// live preview reflects every change immediately and Apply persists.
//
// Curation rules:
//   - Now playing is presence-locked (the menu Home-lock analogue):
//     the assignment that would remove the LAST track gesture is
//     refused with the reason visible, and the resolver backstops
//     stale data (compass-map.ts).
//   - Off hides the chevron AND deadens the gesture - affordance and
//     behaviour never disagree.
//   - The classic arrangement stores nothing; reset is two-step.

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Pencil,
  RotateCcw,
} from "lucide-preact";

import { usePresentation } from "../runtime/presentation-context";
import {
  COMPASS_ACTIONS,
  COMPASS_SLOTS,
  compassOverrides,
  isLastTrackSlot,
  resolveCompassMap,
  type CompassAction,
  type CompassMap,
  type CompassSlot,
} from "../runtime/compass-map";
import type { SmallLanding } from "../runtime/presentation-target";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { mergeProfileForTarget } from "./designer-layout-io";
import { COMPASS_ACTION_ICON } from "../features/pivot/PivotHome";
import { BackBar, Lbl, Seg } from "./builder-controls";

type CompassView = { mode: "outline" } | { mode: "slot"; slot: CompassSlot };

const SLOT_ICON: Record<CompassSlot, typeof ChevronUp> = {
  up: ChevronUp,
  left: ChevronLeft,
  center: CircleDot,
  right: ChevronRight,
  down: ChevronDown,
};

function slotLabel(slot: CompassSlot): string {
  return t(`compass.slot.${slot}` as never);
}
function actionLabel(action: CompassAction): string {
  return t(`compass.act.${action}` as never);
}

export function DesignerCompassEditor(): JSX.Element {
  useLocale();
  const { plan, profileSettings, setProfileSettings } = usePresentation();
  const [view, setView] = useState<CompassView>({ mode: "outline" });
  const [confirmReset, setConfirmReset] = useState(false);

  const map = plan.compass;
  const landing = plan.smallLanding;
  const curated = compassOverrides(map) !== undefined;

  const commitMap = (next: CompassMap) => {
    // Store overrides only; the classic arrangement stores nothing.
    // `compass: undefined` empties the member (the layout-reset
    // pattern) - JSON serialisation drops it.
    setProfileSettings(
      mergeProfileForTarget(profileSettings, plan.targetKey, {
        compass: compassOverrides(next),
      })
    );
  };
  const commitLanding = (next: SmallLanding) => {
    setProfileSettings(
      mergeProfileForTarget(profileSettings, plan.targetKey, {
        smallLanding: next,
      })
    );
  };

  /* ---------------- settings: one gesture ---------------- */
  if (view.mode === "slot") {
    const slot = view.slot;
    const locked = isLastTrackSlot(map, slot);
    return (
      <div className="designer-compass stb-settings" role="group" aria-label={t("compass.title")}>
        <BackBar title={slotLabel(slot)} onBack={() => setView({ mode: "outline" })} />
        <Lbl text={t("compass.title")} help={t("compass.slotHelp")} />
        <Seg
          options={COMPASS_ACTIONS}
          value={map[slot]}
          label={actionLabel}
          disabled={(a) => locked && a !== "track"}
          disabledTitle={() => t("compass.trackLocked")}
          onChange={(action) => {
            if (locked && action !== "track") return;
            commitMap(resolveCompassMap({ ...compassOverrides(map), [slot]: action }));
          }}
        />
        {locked ? <p class="stb-help">{t("compass.trackLocked")}</p> : null}
      </div>
    );
  }

  /* ---------------- outline ---------------- */
  return (
    <div className="designer-compass" role="group" aria-label={t("compass.title")}>
      <div className="stb-head">
        <span className="designer-menu-label">{t("compass.title")}</span>
        {curated ? <span class="stb-badge">{t("compass.custom")}</span> : null}
      </div>
      <p class="stb-help">{t("compass.hint")}</p>

      <Lbl text={t("compass.landing")} help={t("compass.landingHelp")} />
      <Seg
        options={["compass", "track"] as const}
        value={landing}
        label={(v) => t(`compass.landing.${v}` as never)}
        onChange={commitLanding}
      />

      <Lbl text={t("compass.slots")} />
      <div class="compass-slot-list">
        {COMPASS_SLOTS.map((slot) => {
          const Icon = SLOT_ICON[slot];
          return (
            <div
              key={slot}
              class="compass-slot-card"
              data-compass-slot={slot}
              onClick={() => setView({ mode: "slot", slot })}
            >
              <Icon size={14} aria-hidden />
              <span class="compass-slot-name">{slotLabel(slot)}</span>
              <span
                class={
                  map[slot] === "off"
                    ? "compass-slot-action compass-slot-off"
                    : "compass-slot-action"
                }
              >
                {map[slot] !== "off"
                  ? (() => {
                      const A = COMPASS_ACTION_ICON[map[slot]];
                      return <A size={12} aria-hidden />;
                    })()
                  : null}
                {actionLabel(map[slot])}
              </span>
              <button
                type="button"
                class="compass-slot-edit"
                aria-label={`${slotLabel(slot)}: ${t("compass.title")}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setView({ mode: "slot", slot });
                }}
              >
                <Pencil size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {curated ? (
        <button
          type="button"
          class={confirmReset ? "stb-danger" : ""}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              window.setTimeout(() => setConfirmReset(false), 4000);
              return;
            }
            setConfirmReset(false);
            commitMap(resolveCompassMap(undefined));
          }}
        >
          <RotateCcw size={12} />{" "}
          {confirmReset ? t("compass.resetConfirm") : t("compass.reset")}
        </button>
      ) : null}
    </div>
  );
}
