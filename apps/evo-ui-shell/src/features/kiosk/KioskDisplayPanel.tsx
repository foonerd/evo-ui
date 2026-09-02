// Settings -> Display & Touch. LOCAL to this physical player: the whole
// panel is hidden unless inKioskBrowser() (a paired laptop/phone never
// sees it). Orientation persists immediately (the display rotating is the
// confirmation); the advanced touch controls batch all three fields per
// the brief; the wizard is the primary touch-calibration UX.

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { ChevronDown, ChevronRight } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { EvoSelect } from "../../components/EvoSelect";
import { rangeFill } from "../../runtime/range-fill";
import { TouchCalibrationWizard } from "./TouchCalibrationWizard";
import {
  kioskMode,
  setDisplayRotation,
  setTouchCalibration,
  type Rotation
} from "./kiosk-bridge";
import { useKioskRemote } from "./kiosk-remote";

const ROTATIONS: ReadonlyArray<Rotation> = ["0", "90", "180", "270"];

// The plugin accepts 0..=100 but leaves the operator-facing floor to us:
// 0% blacks the screen and hides the control that would raise it again.
const BRIGHTNESS_FLOOR = 5;
const SLEEP_MIN_SECONDS = 5; // plugin refuses non-zero values under 5s
const SLEEP_DEFAULT_SECONDS = 120;

function clampBrightness(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(BRIGHTNESS_FLOOR, Math.round(n)));
}
function clampSleep(n: number): number {
  if (!Number.isFinite(n)) return SLEEP_DEFAULT_SECONDS;
  return Math.max(SLEEP_MIN_SECONDS, Math.round(n));
}

// A screen outline with a bar on the operator-facing edge, rotated by the
// orientation so each option reads as "this is which way up".
function OrientationGlyph({ deg }: { deg: number }): JSX.Element {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      style={{ transform: `rotate(${deg}deg)` }}
      aria-hidden="true"
    >
      <rect
        x="4"
        y="7"
        width="26"
        height="20"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <rect x="10" y="9" width="14" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// Reflect the operator's last-set values across navigation. This is a UI
// cache, NOT the source of truth (the device is) - until the player
// exposes a read verb for current rotation/touch, the panel at least stops
// being amnesiac and shows what was last chosen here. Init from the device
// read once that verb lands.
function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* private mode / disabled - fall back to defaults */
  }
}

export function KioskDisplayPanel(): JSX.Element {
  useLocale();
  const remote = useKioskRemote();
  const isRemote = kioskMode() === "remote";
  const [rotation, setRotation] = useState<Rotation>(
    () => (lsGet("evo.kiosk.rotation") as Rotation | null) ?? "0"
  );
  const [touchRotation, setTouchRotation] = useState<Rotation>(
    () => (lsGet("evo.kiosk.touchRotation") as Rotation | null) ?? "0"
  );
  const [hflip, setHflip] = useState(() => lsGet("evo.kiosk.hflip") === "1");
  const [vflip, setVflip] = useState(() => lsGet("evo.kiosk.vflip") === "1");
  const [advOpen, setAdvOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [launch, setLaunch] = useState<"idle" | "launched">("idle");
  // Set when a remote action can't reach the player (verbs not shipped yet).
  const [remoteBlocked, setRemoteBlocked] = useState(false);

  // Display + power. These four have no on-glass WebKit handler; both glass
  // and remote drive them over the plugin verb. Values are a last-set cache
  // (localStorage) until the device read verb lands, same as rotation.
  const [kioskEnabled, setKioskEnabled] = useState(
    () => lsGet("evo.kiosk.enabled") !== "0"
  );
  const [brightness, setBrightness] = useState(() =>
    clampBrightness(Number(lsGet("evo.kiosk.brightness") ?? "100"))
  );
  const [sleepEnabled, setSleepEnabled] = useState(
    () => lsGet("evo.kiosk.sleepEnabled") !== "0"
  );
  const [sleepSeconds, setSleepSeconds] = useState(() =>
    clampSleep(Number(lsGet("evo.kiosk.sleepSeconds") ?? String(SLEEP_DEFAULT_SECONDS)))
  );
  const [inhibit, setInhibit] = useState(
    () => lsGet("evo.kiosk.inhibit") !== "0"
  );
  const [pendingDisable, setPendingDisable] = useState(false);

  const noteRemote = (res: { ok: boolean }): void => {
    setRemoteBlocked(!res.ok);
  };

  // Seed the panel from the DEVICE on mount (get_display_state), so a fresh
  // boot / any browser shows the real configured rotation/touch/brightness/
  // sleep/enabled - not the localStorage cache. The device is the source of
  // truth; the cache is just an optimistic echo we keep in sync here.
  useEffect(() => {
    let live = true;
    void remote.getDisplayState().then((s) => {
      if (!live || s === null) return;
      setRotation(s.displayRotation);
      lsSet("evo.kiosk.rotation", s.displayRotation);
      setTouchRotation(s.touchRotation);
      lsSet("evo.kiosk.touchRotation", s.touchRotation);
      setHflip(s.hflip);
      lsSet("evo.kiosk.hflip", s.hflip ? "1" : "0");
      setVflip(s.vflip);
      lsSet("evo.kiosk.vflip", s.vflip ? "1" : "0");
      const b = clampBrightness(s.brightnessPercent);
      setBrightness(b);
      lsSet("evo.kiosk.brightness", String(b));
      const sleepOn = s.sleepTimeoutSeconds !== 0;
      setSleepEnabled(sleepOn);
      lsSet("evo.kiosk.sleepEnabled", sleepOn ? "1" : "0");
      if (sleepOn) {
        const sec = clampSleep(s.sleepTimeoutSeconds);
        setSleepSeconds(sec);
        lsSet("evo.kiosk.sleepSeconds", String(sec));
      }
      setInhibit(s.sleepInhibitWhilePlaying);
      lsSet("evo.kiosk.inhibit", s.sleepInhibitWhilePlaying ? "1" : "0");
      setKioskEnabled(s.enabled);
      lsSet("evo.kiosk.enabled", s.enabled ? "1" : "0");
    });
    return () => {
      live = false;
    };
    // Mount-only: one authoritative read; user edits after this own the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyBrightness = (p: number): void => {
    const c = clampBrightness(p);
    setBrightness(c);
    lsSet("evo.kiosk.brightness", String(c));
    void remote.setBrightness(c).then(noteRemote);
  };

  const applySleep = (enabled: boolean, seconds: number): void => {
    const s = clampSleep(seconds);
    setSleepEnabled(enabled);
    setSleepSeconds(s);
    lsSet("evo.kiosk.sleepEnabled", enabled ? "1" : "0");
    lsSet("evo.kiosk.sleepSeconds", String(s));
    // 0 tells the plugin "never sleep"; otherwise the timeout.
    void remote.setSleepTimeout(enabled ? s : 0).then(noteRemote);
  };

  const applyInhibit = (b: boolean): void => {
    setInhibit(b);
    lsSet("evo.kiosk.inhibit", b ? "1" : "0");
    void remote.setSleepInhibitWhilePlaying(b).then(noteRemote);
  };

  const commitEnabled = (b: boolean): void => {
    setKioskEnabled(b);
    lsSet("evo.kiosk.enabled", b ? "1" : "0");
    void remote.setEnabled(b).then(noteRemote);
  };

  // Disabling kiosk stops the compositor session. From the glass that blacks
  // out the very screen being used, so confirm first; from a remote browser
  // the glass is elsewhere and it applies straight away.
  const applyEnabled = (b: boolean): void => {
    if (!b && !isRemote) {
      setPendingDisable(true);
      return;
    }
    commitEnabled(b);
  };

  const pickOrientation = (r: Rotation): void => {
    setRotation(r);
    lsSet("evo.kiosk.rotation", r);
    if (isRemote) void remote.setDisplayRotation(r).then(noteRemote);
    else setDisplayRotation(r);
  };

  // Batched apply: every touch change sends all three fields in one call
  // (WebKit handler on the glass; wire op from a remote browser).
  const applyTouch = (r: Rotation, h: boolean, v: boolean): void => {
    setTouchRotation(r);
    setHflip(h);
    setVflip(v);
    lsSet("evo.kiosk.touchRotation", r);
    lsSet("evo.kiosk.hflip", h ? "1" : "0");
    lsSet("evo.kiosk.vflip", v ? "1" : "0");
    if (isRemote) void remote.setTouchCalibration(r, h, v).then(noteRemote);
    else setTouchCalibration(r, h, v);
  };

  // On the glass the wizard captures corners here; from a remote browser we
  // launch it on the player's own screen (a laptop tap can't sample the
  // device digitiser) and tell the operator to walk over and tap.
  const onCalibrate = (): void => {
    if (!isRemote) {
      setWizardOpen(true);
      return;
    }
    setLaunch("idle");
    void remote.launchCalibration().then((res) => {
      noteRemote(res);
      if (res.ok) setLaunch("launched");
    });
  };

  return (
    <div className="kiosk-panel">
      <p className="feature-description settings-help">
        {isRemote ? t("kiosk.remoteHint") : t("kiosk.localOnly")}
      </p>
      {isRemote && remoteBlocked ? (
        <p className="feature-description settings-help net-notice kiosk-remote-blocked">
          {t("kiosk.remoteUnavailable")}
        </p>
      ) : null}

      <div className="kiosk-section">
        <span className="kiosk-section-label">{t("kiosk.orientation")}</span>
        <div
          className="kiosk-orient-grid"
          role="radiogroup"
          aria-label={t("kiosk.orientation")}
        >
          {ROTATIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rotation === r}
              className={"kiosk-orient-btn" + (rotation === r ? " is-active" : "")}
              onClick={() => pickOrientation(r)}
            >
              <OrientationGlyph deg={Number(r)} />
              <span>{t(`kiosk.orient.${r}` as never)}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="kiosk-adv-toggle"
        aria-expanded={advOpen}
        onClick={() => setAdvOpen((o) => !o)}
      >
        {advOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t("kiosk.advancedTouch")}
      </button>
      {advOpen ? (
        <div className="kiosk-adv">
          <label className="kiosk-adv-row">
            <span>{t("kiosk.touchRotation")}</span>
            <EvoSelect
              ariaLabel={t("kiosk.touchRotation")}
              value={touchRotation}
              options={ROTATIONS.map((v) => ({ value: v, label: `${v}°` }))}
              onChange={(v) => applyTouch(v as Rotation, hflip, vflip)}
            />
          </label>
          <div className="kiosk-adv-row">
            <span>{t("kiosk.hflip")}</span>
            <button
              type="button"
              className={"evo-toggle" + (hflip ? " on" : "")}
              aria-pressed={hflip}
              onClick={() => applyTouch(touchRotation, !hflip, vflip)}
            >
              {hflip ? t("kiosk.on") : t("kiosk.off")}
            </button>
          </div>
          <div className="kiosk-adv-row">
            <span>{t("kiosk.vflip")}</span>
            <button
              type="button"
              className={"evo-toggle" + (vflip ? " on" : "")}
              aria-pressed={vflip}
              onClick={() => applyTouch(touchRotation, hflip, !vflip)}
            >
              {vflip ? t("kiosk.on") : t("kiosk.off")}
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="settings-action-primary kiosk-calibrate-btn"
        onClick={onCalibrate}
      >
        {isRemote ? t("kiosk.calibrateOnDevice") : t("kiosk.calibrate")}
      </button>

      {isRemote && launch === "launched" ? (
        <p className="feature-description settings-help kiosk-launch-ok">
          {t("kiosk.calLaunched")}
        </p>
      ) : null}

      <div className="kiosk-section">
        <span className="kiosk-section-label">{t("kiosk.power")}</span>

        <div className="kiosk-adv-row">
          <span>{t("kiosk.brightness")}</span>
          <div className="kiosk-slider-wrap">
            <input
              type="range"
              min={BRIGHTNESS_FLOOR}
              max={100}
              value={brightness}
              style={rangeFill(((brightness - BRIGHTNESS_FLOOR) / (100 - BRIGHTNESS_FLOOR)) * 100)}
              aria-label={t("kiosk.brightness")}
              onInput={(e) =>
                applyBrightness(Number((e.target as HTMLInputElement).value))
              }
            />
            <span className="kiosk-slider-val">{brightness}%</span>
          </div>
        </div>

        <div className="kiosk-adv-row">
          <span>{t("kiosk.screenSleep")}</span>
          <button
            type="button"
            className={"evo-toggle" + (sleepEnabled ? " on" : "")}
            aria-pressed={sleepEnabled}
            onClick={() => applySleep(!sleepEnabled, sleepSeconds)}
          >
            {sleepEnabled ? t("kiosk.on") : t("kiosk.off")}
          </button>
        </div>
        {sleepEnabled ? (
          <label className="kiosk-adv-row">
            <span>{t("kiosk.sleepAfter")}</span>
            <input
              className="kiosk-num"
              type="number"
              min={SLEEP_MIN_SECONDS}
              step={5}
              value={sleepSeconds}
              aria-label={t("kiosk.sleepAfter")}
              onChange={(e) =>
                applySleep(true, Number((e.target as HTMLInputElement).value))
              }
            />
          </label>
        ) : null}

        <div className="kiosk-adv-row">
          <span>{t("kiosk.stayAwakePlaying")}</span>
          <button
            type="button"
            className={"evo-toggle" + (inhibit ? " on" : "")}
            aria-pressed={inhibit}
            onClick={() => applyInhibit(!inhibit)}
          >
            {inhibit ? t("kiosk.on") : t("kiosk.off")}
          </button>
        </div>

        <div className="kiosk-adv-row">
          <span>{t("kiosk.kioskEnabled")}</span>
          <button
            type="button"
            className={"evo-toggle" + (kioskEnabled ? " on" : "")}
            aria-pressed={kioskEnabled}
            onClick={() => applyEnabled(!kioskEnabled)}
          >
            {kioskEnabled ? t("kiosk.on") : t("kiosk.off")}
          </button>
        </div>
        {pendingDisable ? (
          <div className="kiosk-confirm">
            <p className="settings-help">{t("kiosk.disableConfirm")}</p>
            <div className="kiosk-cal-actions">
              <button
                type="button"
                className="settings-action-primary"
                onClick={() => {
                  setPendingDisable(false);
                  commitEnabled(false);
                }}
              >
                {t("kiosk.disableConfirmYes")}
              </button>
              <button type="button" onClick={() => setPendingDisable(false)}>
                {t("dialog.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!isRemote && wizardOpen ? (
        <TouchCalibrationWizard onClose={() => setWizardOpen(false)} />
      ) : null}
    </div>
  );
}
