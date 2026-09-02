import {
  AlarmClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cog,
  Heart,
  Image,
  ListMusic,
  ListOrdered,
  Moon,
  Music,
  Power,
  RotateCcw,
  Speaker,
  User
} from "lucide-preact";
import {
  useSystemPowerConfirm,
  SystemPowerConfirmModal
} from "../system/SystemPowerConfirm";
import { PivotQueueReveal } from "../queue/PivotQueueReveal";
import { PivotArtReveal } from "./PivotArtReveal";
import { PivotBioReveal } from "./PivotBioReveal";
import { PlaybackSurface } from "../playback/PlaybackSurface";
import type { PlaybackSurfaceProps } from "../playback/PlaybackSurface";
import type { PivotReveal } from "./pivot-registry";
import type { NavView } from "../../app/nav-types";
import type { SmallLanding } from "../../runtime/presentation-target";
import {
  isCompassNavAction,
  type CompassAction,
  type CompassMap
} from "../../runtime/compass-map";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

interface PivotHomeProps extends PlaybackSurfaceProps {
  onNavigate: (view: NavView) => void;
  smallLanding: SmallLanding;
  /** Curated compass slot map (compass-map.ts) - resolved by the
   *  presentation plan; the anchor renders and routes from it. */
  compass: CompassMap;
}

/** Operator-facing name of a compass action (i18n catalog). */
export function compassActionLabel(action: CompassAction): string {
  return t(`compass.act.${action}` as never);
}

/** Destination icon per compass action - the "what is inside" hint
 *  (B treatment, ruled 2026-07-14): each chevron carries its
 *  assignment's icon on the centre side, and the anchor shows the
 *  centre action's icon. Derived purely from the curated map. */
export const COMPASS_ACTION_ICON: Record<
  Exclude<CompassAction, "off">,
  typeof Music
> = {
  track: Music,
  art: Image,
  bio: User,
  library: ListOrdered,
  favourites: Heart,
  playlists: ListMusic,
  device: Cog,
};

function PivotAnchor({
  compass,
  onAction
}: {
  compass: CompassMap;
  onAction: (action: CompassAction) => void;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: PointerEvent) => {
    startRef.current = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (start === null) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const threshold = 36;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      onAction(compass.center);
      return;
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      onAction(dx < 0 ? compass.left : compass.right);
    } else {
      onAction(dy < 0 ? compass.up : compass.down);
    }
  };

  // Chevrons render only for slots that carry an action: an "off"
  // slot shows nothing and its swipe is inert - the affordance and
  // the gesture always agree. B treatment: the chevron points
  // OUTWARD (the swipe hint) and the assignment's icon sits on the
  // centre side (the destination hint).
  const chevron = (
    slot: "up" | "left" | "right" | "down",
    Icon: typeof ChevronUp
  ) => {
    const action = compass[slot];
    if (action === "off") return null;
    const Dest = COMPASS_ACTION_ICON[action];
    const chev = <Icon size={15} strokeWidth={2} aria-hidden />;
    const dest = (
      <Dest size={13} strokeWidth={2} className="pivot-direction-dest" aria-hidden />
    );
    // Chevron on the OUTER edge: up/left = chevron first; down/right
    // = destination icon first.
    const outerFirst = slot === "up" || slot === "left";
    return (
      <button
        type="button"
        className={`pivot-direction pivot-direction-${slot}`}
        aria-label={compassActionLabel(action)}
        title={compassActionLabel(action)}
        onClick={() => onAction(action)}
      >
        {outerFirst ? chev : dest}
        {outerFirst ? dest : chev}
      </button>
    );
  };

  const CenterIcon =
    compass.center === "off" ? null : COMPASS_ACTION_ICON[compass.center];

  return (
    <div className="pivot-anchor-wrap">
      <div className="pivot-dpad" role="group" aria-label={t("compass.group")}>
        {chevron("up", ChevronUp)}
        {chevron("left", ChevronLeft)}
        <button
          type="button"
          className="pivot-anchor"
          aria-label={
            compass.center === "off"
              ? t("compass.anchorSwipeOnly")
              : t("compass.anchor", { action: compassActionLabel(compass.center) })
          }
          title={compass.center === "off" ? undefined : compassActionLabel(compass.center)}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {CenterIcon !== null ? (
            <CenterIcon size={18} strokeWidth={2} className="pivot-anchor-ico" aria-hidden />
          ) : (
            <span className="pivot-anchor-dot" aria-hidden />
          )}
        </button>
        {chevron("right", ChevronRight)}
        {chevron("down", ChevronDown)}
      </div>
    </div>
  );
}

function CompassDismiss({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="pivot-compass-dismiss"
      onClick={onClick}
      aria-label={t("compass.back")}
      title={t("compass.back")}
    >
      <ChevronDown size={18} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** Device reveal (centre-tap) - deliberately minimal per
 *  SMALL_SCREEN_PIVOT.md and the small-screen decision: a power
 *  cluster plus the two destinations that have their own surfaces.
 *
 *  - Power off / Reboot: live system.power verbs (guarded confirm).
 *    Disabled when the system.power plugin is not admitted, so they
 *    never act on a device that cannot honour them.
 *  - Sleep: the four-state power state machine (Active/Idle/Standby/Off)
 *    is a follow-on primitive. The affordance is shown so the shape is
 *    real, but inert until the verb exists - never wired to nothing.
 *  - Alarm: drills to the alarms/schedules surface.
 *  - Multi-room: drills to its own surface (MULTIROOM-FLOWS.md). */
function PivotDeviceReveal({
  onNavigate
}: {
  onNavigate: (view: NavView) => void;
}) {
  useLocale();
  const power = useSystemPowerConfirm();
  return (
    <div className="pivot-device">
      <p className="nav-group-title">{t("compass.act.device")}</p>
      <div className="pivot-tile-grid">
        <button
          type="button"
          className="pivot-tile pivot-tile-danger"
          disabled={!power.available}
          title={
            power.available
              ? t("app.powerOff")
              : t("pivot.powerOffUnavailable")
          }
          onClick={() => power.setConfirm("power_off")}
        >
          <Power size={18} />
          <span>{t("app.powerOff")}</span>
        </button>
        <button
          type="button"
          className="pivot-tile"
          disabled={!power.available}
          title={
            power.available ? t("app.reboot") : t("pivot.rebootUnavailable")
          }
          onClick={() => power.setConfirm("reboot")}
        >
          <RotateCcw size={18} />
          <span>{t("app.reboot")}</span>
        </button>
        <button
          type="button"
          className="pivot-tile pivot-tile-pending"
          disabled
          title={t("pivot.sleepPending")}
        >
          <Moon size={18} />
          <span>{t("pivot.sleep")}</span>
        </button>
        <button
          type="button"
          className="pivot-tile"
          onClick={() => onNavigate("alarm")}
        >
          <AlarmClock size={18} />
          <span>{t("pivot.alarm")}</span>
        </button>
        <button
          type="button"
          className="pivot-tile"
          onClick={() => onNavigate("multiroom")}
        >
          <Speaker size={18} />
          <span>{t("nav.multiroom")}</span>
        </button>
      </div>
      <SystemPowerConfirmModal
        confirm={power.confirm}
        busy={power.busy}
        accepted={power.accepted}
        error={power.error}
        onCancel={power.closeConfirm}
        onConfirm={() => void power.onConfirmAction()}
      />
    </div>
  );
}

function initialReveal(landing: SmallLanding): PivotReveal {
  return landing === "track" ? "track" : "rest";
}

export function PivotHome({
  onNavigate,
  smallLanding,
  compass,
  ...playbackProps
}: PivotHomeProps) {
  useLocale();
  const [reveal, setReveal] = useState<PivotReveal>(() =>
    initialReveal(smallLanding)
  );

  useEffect(() => {
    setReveal(initialReveal(smallLanding));
  }, [smallLanding]);

  const openAction = useCallback(
    (action: CompassAction) => {
      if (action === "off") {
        return;
      }
      // Destination actions leave home for their full surface - the
      // same contract as the Device tiles (Alarms / Multi-room).
      if (isCompassNavAction(action)) {
        onNavigate(action);
        return;
      }
      setReveal(action);
    },
    [onNavigate]
  );

  const returnHome = useCallback(() => {
    setReveal(smallLanding === "track" ? "track" : "rest");
  }, [smallLanding]);

  const showCompassRest = reveal === "rest";
  const showTrackLanding = reveal === "track" && smallLanding === "track";
  const showTrackOverlay = reveal === "track" && smallLanding === "compass";

  return (
    <div className="pivot-home" data-pivot-reveal={reveal}>
      {showCompassRest ? (
        <div className="pivot-home-rest">
          <PivotAnchor compass={compass} onAction={openAction} />
        </div>
      ) : null}

      {showTrackLanding ? (
        <div className="pivot-home-track-landing">
          <PlaybackSurface variant="pivot-track" {...playbackProps} />
          <CompassDismiss onClick={() => setReveal("rest")} />
        </div>
      ) : null}

      {showTrackOverlay ? (
        <div
          className="pivot-overlay pivot-overlay-track"
          role="dialog"
          aria-label={t("compass.act.track")}
        >
          <span className="pivot-overlay-sheet-handle" aria-hidden />
          <PlaybackSurface variant="pivot-track" {...playbackProps} />
          <CompassDismiss onClick={() => setReveal("rest")} />
        </div>
      ) : null}

      {reveal === "art" ? (
        <div
          className="pivot-overlay pivot-overlay-art"
          role="dialog"
          aria-label={t("compass.act.art")}
        >
          <CompassDismiss onClick={returnHome} />
          <PivotArtReveal />
        </div>
      ) : null}

      {reveal === "bio" ? (
        <div
          className="pivot-overlay pivot-overlay-bio"
          role="dialog"
          aria-label={t("compass.act.bio")}
        >
          <CompassDismiss onClick={returnHome} />
          <PivotBioReveal />
        </div>
      ) : null}

      {reveal === "library" ? (
        <div
          className="pivot-overlay pivot-overlay-library"
          role="dialog"
          aria-label={t("compass.act.library")}
        >
          <CompassDismiss onClick={returnHome} />
          <PivotQueueReveal />
        </div>
      ) : null}

      {reveal === "device" ? (
        <div
          className="pivot-overlay pivot-overlay-device"
          role="dialog"
          aria-label={t("compass.act.device")}
        >
          <CompassDismiss onClick={returnHome} />
          <PivotDeviceReveal onNavigate={onNavigate} />
        </div>
      ) : null}
    </div>
  );
}
