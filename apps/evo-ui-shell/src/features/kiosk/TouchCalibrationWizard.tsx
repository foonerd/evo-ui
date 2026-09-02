// Full-screen touch-calibration wizard. Flow per the kiosk brief:
//   reset -> capture 4 corners -> submit -> confirm derived -> verify tap.
// Coordinates are normalised [0,1] with (0,0) top-left of the output.
// Calibration MUST be reset to identity before capture, else the "actual"
// taps are already transformed and the derived matrix is wrong.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Check } from "lucide-preact";
import { t } from "../../runtime/i18n";
import {
  sampleTouchFromCorners,
  setTouchCalibration,
  type CalibrationSample,
  type DerivedCalibration
} from "./kiosk-bridge";

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

  const restart = useCallback((): void => {
    samplesRef.current = [];
    setCornerIdx(0);
    setCaptured(false);
    setDerived(null);
    setErrorMsg("");
    setPhase("reset");
  }, []);

  // Reset to identity, let the systemd path unit apply, then capture.
  useEffect(() => {
    if (phase !== "reset") return;
    let live = true;
    setTouchCalibration("0", false, false);
    const id = setTimeout(() => {
      if (live) setPhase("capture");
    }, 500);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [phase]);

  // Submit once all four corners are captured.
  useEffect(() => {
    if (phase !== "submitting") return;
    let live = true;
    void sampleTouchFromCorners(samplesRef.current)
      .then((d) => {
        if (!live) return;
        setDerived(d);
        setPhase("confirm");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      live = false;
    };
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
          {derived.mean_error > 0.05 ? (
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
