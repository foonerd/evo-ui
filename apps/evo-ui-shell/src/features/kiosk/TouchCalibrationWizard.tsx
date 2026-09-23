// Full-screen touch-calibration wizard. Flow per the kiosk brief:
//   reset -> capture 4 corners -> submit -> confirm derived -> verify tap.
// Coordinates are normalised [0,1] with (0,0) top-left of the output.
// Calibration MUST be reset to identity before capture, else the "actual"
// taps are already transformed and the derived matrix is wrong.
//
// BOTH of this wizard's writes go over the system.kiosk plugin verbs, the
// same route the Display & Touch panel takes and the same route a remote
// browser takes. They used to go through the WebKit bridge
// (evo_set_touch_calibration, evo_sample_touch_calibration_from_corners),
// which reaches the identical evo-kiosk-config functions in-process and so
// could not be refused by anything: not the per-verb capability gate, not
// the household policy. The reset is the sharper half of that - it wipes
// the touch matrix as its FIRST act, so an ungated wizard could break touch
// on a box whose policy forbids exactly that, and then be unable to put it
// back.
//
// One route, one classifier: every outcome here goes through
// classifyKioskWrite, so a household refusal opens the one household modal
// and anything else is an honest failure. Never Pair.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Check } from "lucide-preact";
import { t } from "../../runtime/i18n";
import type { CalibrationSample } from "./kiosk-bridge";
import { useKioskRemote } from "./kiosk-remote";
import {
  KIOSK_CAL_WRITE_DEADLINE_MS,
  classifyKioskWrite,
  readDerivedCalibration,
  settleKioskCalWrite,
  type DerivedCalibration
} from "./osk-state";
import { useHouseholdModal } from "../household/HouseholdModalHost";

const CORNERS: ReadonlyArray<{ x: number; y: number; key: string }> = [
  { x: 0.1, y: 0.1, key: "kiosk.cal.topLeft" },
  { x: 0.9, y: 0.1, key: "kiosk.cal.topRight" },
  { x: 0.9, y: 0.9, key: "kiosk.cal.bottomRight" },
  { x: 0.1, y: 0.9, key: "kiosk.cal.bottomLeft" }
];

type Phase =
  | "reset"
  | "capture"
  | "submitting"
  | "confirm"
  | "verify"
  | "error";

export function TouchCalibrationWizard(props: {
  onClose: () => void;
}): JSX.Element {
  const { onClose } = props;
  const [phase, setPhase] = useState<Phase>("reset");
  const [cornerIdx, setCornerIdx] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [derived, setDerived] = useState<DerivedCalibration | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const samplesRef = useRef<CalibrationSample[]>([]);
  const remote = useKioskRemote();
  const household = useHouseholdModal();

  // A household refusal is not a wizard error. Close the wizard and put
  // the operator in front of the one door that can resolve it - the same
  // modal the Calibrate open-guard opens, never a second host. With no
  // household context (designer, tests) there is no door to open, so say
  // what happened instead of dead-ending.
  const onLocked = useCallback((): void => {
    if (household !== null) {
      onClose();
      household.open();
      return;
    }
    setErrorMsg(t("household.locked.body"));
    setPhase("error");
  }, [household, onClose]);

  const restart = useCallback((): void => {
    samplesRef.current = [];
    setCornerIdx(0);
    setCaptured(false);
    setDerived(null);
    setErrorMsg("");
    setPhase("reset");
  }, []);

  // Reset to identity over the gated verb, let the systemd path unit
  // apply, then capture. Capture starts only once the player has ACCEPTED
  // the reset - starting it on a refused reset would sample taps that are
  // still transformed and derive a matrix from them.
  useEffect(() => {
    if (phase !== "reset") return;
    let live = true;
    let id: ReturnType<typeof setTimeout> | undefined;
    const ac = new AbortController();
    const deadline = window.setTimeout(
      () => ac.abort(),
      KIOSK_CAL_WRITE_DEADLINE_MS
    );
    void settleKioskCalWrite(
      remote.setTouchCalibration("0", false, false, { signal: ac.signal }),
      ac.signal
    ).then((res) => {
      if (!live) return;
      switch (classifyKioskWrite(res)) {
        case "ok":
          id = setTimeout(() => {
            if (live) setPhase("capture");
          }, 500);
          return;
        case "locked":
          onLocked();
          return;
        default:
          setErrorMsg(
            res.message === "aborted"
              ? t("kiosk.cal.noReply")
              : (res.message ?? t("kiosk.displayRefused"))
          );
          setPhase("error");
      }
    });
    return () => {
      live = false;
      ac.abort();
      window.clearTimeout(deadline);
      if (id !== undefined) clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Submit once all four corners are captured. The player derives and
  // persists; we only read back what it decided.
  useEffect(() => {
    if (phase !== "submitting") return;
    let live = true;
    const ac = new AbortController();
    const deadline = window.setTimeout(
      () => ac.abort(),
      KIOSK_CAL_WRITE_DEADLINE_MS
    );
    void settleKioskCalWrite(
      remote.deriveTouchCalibrationFromCorners(samplesRef.current, {
        signal: ac.signal
      }),
      ac.signal
    ).then((res) => {
      if (!live) return;
      switch (classifyKioskWrite(res)) {
        case "ok": {
          const d = readDerivedCalibration(
            "value" in res ? res.value : undefined
          );
          if (d === null) {
            // Accepted but unreadable: report it rather than paint a
            // triple we made up.
            setErrorMsg(t("kiosk.cal.unreadable"));
            setPhase("error");
            return;
          }
          setDerived(d);
          setPhase("confirm");
          return;
        }
        case "locked":
          onLocked();
          return;
        default:
          setErrorMsg(
            res.message === "aborted"
              ? t("kiosk.cal.noReply")
              : (res.message ?? t("kiosk.displayRefused"))
          );
          setPhase("error");
      }
    });
    return () => {
      live = false;
      ac.abort();
      window.clearTimeout(deadline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onCaptureTap = useCallback(
    (ev: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
      if (phase !== "capture" || captured) return;
      const corner = CORNERS[cornerIdx];
      samplesRef.current.push({
        target_x: corner.x,
        target_y: corner.y,
        actual_x: ev.clientX / window.innerWidth,
        actual_y: ev.clientY / window.innerHeight
      });
      setCaptured(true);
      window.setTimeout(() => {
        if (cornerIdx >= CORNERS.length - 1) {
          setPhase("submitting");
        } else {
          setCornerIdx((i) => i + 1);
          setCaptured(false);
        }
      }, 300);
    },
    [phase, captured, cornerIdx]
  );

  const derivedSummary = (d: DerivedCalibration): string => {
    const flips: string[] = [];
    if (d.hflip) flips.push(t("kiosk.cal.hflip"));
    if (d.vflip) flips.push(t("kiosk.cal.vflip"));
    const flipText =
      flips.length > 0 ? flips.join(", ") : t("kiosk.cal.noFlips");
    return t("kiosk.cal.summary", { rotation: d.rotation, flips: flipText });
  };

  return (
    <div className="kiosk-cal-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="kiosk-cal-cancel"
        onClick={onClose}
      >
        {t("dialog.cancel")}
      </button>

      {(phase === "reset" || phase === "submitting") && (
        <div className="kiosk-cal-center">
          <p className="kiosk-cal-prompt">
            {phase === "reset"
              ? t("kiosk.cal.resetting")
              : t("kiosk.cal.deriving")}
          </p>
        </div>
      )}

      {phase === "capture" && (
        <div className="kiosk-cal-capture" onPointerDown={onCaptureTap}>
          <p className="kiosk-cal-prompt kiosk-cal-prompt-top">
            {t("kiosk.cal.tapTarget")} - {t(CORNERS[cornerIdx].key as never)} (
            {cornerIdx + 1}/4)
          </p>
          <div
            className={
              "kiosk-cal-target" + (captured ? " is-hit" : "")
            }
            style={{
              left: `${CORNERS[cornerIdx].x * 100}%`,
              top: `${CORNERS[cornerIdx].y * 100}%`
            }}
          >
            {captured ? <Check size={28} /> : null}
          </div>
        </div>
      )}

      {phase === "confirm" && derived !== null && (
        <div className="kiosk-cal-center">
          <p className="kiosk-cal-result">{derivedSummary(derived)}</p>
          {derived.meanError > 0.05 ? (
            <p className="kiosk-cal-warn">{t("kiosk.cal.imperfect")}</p>
          ) : null}
          <div className="kiosk-cal-actions">
            <button
              type="button"
              className="settings-action-primary"
              onClick={() => setPhase("verify")}
            >
              {t("kiosk.cal.continue")}
            </button>
            <button type="button" onClick={restart}>
              {t("kiosk.cal.redo")}
            </button>
          </div>
        </div>
      )}

      {phase === "verify" && (
        <div
          className="kiosk-cal-capture"
          onPointerDown={restart}
        >
          <p className="kiosk-cal-prompt kiosk-cal-prompt-top">
            {t("kiosk.cal.verifyPrompt")}
          </p>
          <button
            type="button"
            className="kiosk-cal-verify-btn"
            onPointerDown={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            {t("dialog.done")}
          </button>
        </div>
      )}

      {phase === "error" && (
        <div className="kiosk-cal-center">
          <p className="kiosk-cal-warn">
            {t("kiosk.cal.failed")} {errorMsg}
          </p>
          <div className="kiosk-cal-actions">
            <button
              type="button"
              className="settings-action-primary"
              onClick={restart}
            >
              {t("kiosk.cal.redo")}
            </button>
            <button type="button" onClick={onClose}>
              {t("dialog.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
