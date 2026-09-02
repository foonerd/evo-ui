import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Monitor, Search, Smartphone, Tablet, X } from "lucide-preact";
import { DENSITY_OPTIONS, THEME_OPTIONS, type DensityId } from "../app/App";
import {
  readDesignerTheme,
  writeDesignerTheme
} from "../runtime/designer-appearance";
import {
  formatResolution,
  type DisplayOrientation
} from "../runtime/display-test-matrix";
import {
  loadDisplayPresetCatalog,
  type DisplayPresetEntry
} from "../runtime/display-preset-catalog";
import { PresentationProvider, usePresentation } from "../runtime/presentation-context";
import { writeEmbedProfile } from "../runtime/designer-embed";
import { DesignerScopeProvider, useDesignerScope } from "./designer-scope";
import {
  readTitleOverflow,
  writeTitleOverflow
} from "../features/playback/nowplaying-prefs";
import {
  deviceKindLabel,
  deviceKindSettingLabel,
  sizeClassFor,
  type DeviceKindSetting,
  type ResolvedDeviceKind
} from "../runtime/presentation-target";
import { FullLayoutNavGuide } from "./PivotNavGuide";
import { DesignerCompassEditor } from "./DesignerCompassEditor";
import { mergeProfileForTarget, mergeScopedDial } from "./designer-layout-io";
import { useDeviceSetting } from "./use-device-setting";
import { DesignerMenuEditor } from "./DesignerMenuEditor";
import { DesignerStageCanvas } from "./DesignerStageCanvas";
import { DesignerPagesEditor } from "./DesignerPagesEditor";
import { DesignerBuildStage, type BuildSelection } from "./DesignerBuildStage";
import { t, tn } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { DesignerStageOutline } from "./DesignerStageOutline";
import { DesignerVisualizerStudio } from "./DesignerVisualizerStudio";
import { StageEditorProvider, useStageEditor } from "./stage-editor-state";
import {
  DesignerHistoryControls,
  DesignerHistoryProvider,
} from "./designer-history-state";

type DesignerTab = "screen" | "scale" | "home" | "menu" | "pages" | "viz";
import { GatewayClient } from "../core/gateway-client";
import {
  designerApplyLabel,
  useDesignerProfileSync,
  type DesignerApplyState
} from "./designer-profile";

function AspectGlyph({
  widthPx,
  heightPx,
  active
}: {
  widthPx: number;
  heightPx: number;
  active: boolean;
}) {
  const box = 28;
  const ratio = widthPx / heightPx;
  let w = box - 6;
  let h = box - 6;
  if (ratio >= 1) {
    h = w / ratio;
  } else {
    w = h * ratio;
  }
  const x = (box - w) / 2;
  const y = (box - h) / 2;
  return (
    <svg
      className={
        active ? "designer-aspect-glyph designer-aspect-glyph-active" : "designer-aspect-glyph"
      }
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden
    >
      <rect x={x} y={y} width={w} height={h} rx="2.5" className="designer-aspect-glyph-screen" />
    </svg>
  );
}

// CompactLandingToggle RETIRED (2026-07-14): the landing choice moved
// into DesignerCompassEditor - the compass curation surface owns ALL
// compact-home behaviour (landing + gesture map) in one place.

/** Home style: Auto (heuristic) / Compass / Full layout - the
 *  operator's per-target override. A sharp small OLED can take the
 *  full pages designer; the true-PPI touch floor keeps its targets
 *  finger-safe. Stored beside the other display prefs. */
function HomeStyleToggle() {
  useLocale();
  const { plan, profileSettings, setProfileSettings } = usePresentation();
  const stored =
    (plan.targetKey != null
      ? profileSettings?.byTarget?.[plan.targetKey]?.homeMode
      : profileSettings?.custom?.homeMode) ?? "auto";
  return (
    <div className="designer-home-style" role="group" aria-label={t("compass.homeStyle")}>
      <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8 }}>
        {t("compass.homeStyle")}
      </span>
      <div class="stb-seg">
        {(["auto", "compass", "full"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            class={stored === mode ? "on" : ""}
            aria-pressed={stored === mode}
            onClick={() =>
              setProfileSettings(
                mergeProfileForTarget(profileSettings, plan.targetKey, {
                  homeMode: mode === "auto" ? undefined : mode
                })
              )
            }
          >
            {t(`compass.homeStyle.${mode}` as never)}
          </button>
        ))}
      </div>
      <p className="designer-tab-hint">{t("compass.homeStyleHelp")}</p>
    </div>
  );
}

function DesignerThemePicker() {
  useLocale();
  const [themeSel, setThemeSel] = useState(() => {
    const override = readDesignerTheme();
    if (override !== null) return override;
    try {
      return window.localStorage.getItem("evo-ui-shell.theme") ?? "evo-default";
    } catch {
      return "evo-default";
    }
  });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingBottom: "10px",
        borderBottom:
          "0.5px solid color-mix(in oklab, var(--border) 60%, transparent)"
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8 }}>
        {t("designer.theme")}
      </span>
      <div className="designer-theme-swatches" role="radiogroup" aria-label={t("designer.theme")}>
        {THEME_OPTIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={themeSel === t.id}
            aria-label={t.label}
            title={t.label}
            className={
              themeSel === t.id
                ? "designer-theme-swatch is-selected"
                : "designer-theme-swatch"
            }
            onClick={() => {
              writeDesignerTheme(t.id);
              setThemeSel(t.id);
            }}
          >
            <span
              className={`designer-theme-swatch-preview theme-${t.id}`}
              aria-hidden
            >
              <span className="designer-theme-swatch-bar" />
              <span className="designer-theme-swatch-dot" />
            </span>
            <span className="designer-theme-swatch-label">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="designer-tab-hint">{t("builder.themeApplyNote")}</p>
    </div>
  );
}

/** Density - a DEVICE setting since consolidation slice 2
 *  (ui.density, live fan-out like ui.theme); previously a
 *  per-browser localStorage pref edited in Settings. The designer
 *  is its authority now: patched immediately, conflict-retried,
 *  every session follows within the stream latency. */
function DensityControl() {
  useLocale();
  const density = useDeviceSetting<DensityId>(
    "ui.density",
    (v): v is DensityId => v === "comfortable" || v === "compact",
    "comfortable"
  );
  return (
    <div className="designer-density" role="group" aria-label={t("scale.density")}>
      <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8 }}>
        {t("scale.density")}
      </span>
      <div class="stb-seg">
        {DENSITY_OPTIONS.map((o) => (
          <button key={o.id} type="button" class={density.value === o.id ? "on" : ""}
            aria-pressed={density.value === o.id} onClick={() => density.set(o.id)}>
            {t(`scale.density.${o.id}` as never)}
          </button>
        ))}
      </div>
      {density.error ? <p class="stb-refusal">{t("viz.saveFailed")}</p> : (
        <p className="designer-tab-hint">{t("scale.densityHelp")}</p>
      )}
    </div>
  );
}

function ScaleControls() {
  useLocale();
  const {
    plan,
    profileSettings,
    setProfileSettings,
    diagonalInches,
    setDiagonalInches,
    setDialScope
  } = usePresentation();
  const { scope } = useDesignerScope();
  // Resolve the designer's own plan dials for the scope being edited, so the
  // sliders below show that scope's stored touch/type (native per-target, or
  // the remote scope's independent dials) - not always native.
  useEffect(() => {
    setDialScope(scope);
  }, [scope, setDialScope]);
  // Show the RESOLVED values (scope-aware: remote reads remote, native reads
  // byTarget/custom, then default), so the sliders reflect what the plan uses.
  const touchScale = plan.touchScale;
  const typeScale = plan.typeScale;
  const displayZoom = plan.displayZoom;
  const [overflowMode, setOverflowMode] = useState(readTitleOverflow());
  const rowStyle = { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" };
  const labelStyle = { flex: "0 0 76px", opacity: 0.75 };
  const numStyle = { width: "56px" };
  return (
    <div
      className="designer-scale"
      role="group"
      aria-label={t("scale.physical")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        paddingTop: "8px",
        borderTop: "0.5px solid color-mix(in oklab, var(--border) 60%, transparent)"
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8 }}>{t("scale.physical")}</span>
      <label style={rowStyle}>
        <span style={labelStyle}>{t("scale.diagonalIn")}</span>
        <input
          type="range"
          min={1}
          max={32}
          step={0.1}
          value={diagonalInches ?? 5}
          onInput={(e) => setDiagonalInches(Number((e.currentTarget as HTMLInputElement).value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={1}
          max={120}
          step={0.1}
          value={diagonalInches ?? ""}
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            setDiagonalInches(Number.isFinite(v) && v > 0 ? v : null);
          }}
          style={numStyle}
        />
      </label>
      <label style={rowStyle}>
        <span style={labelStyle}>{t("scale.touch")}</span>
        <input
          type="range"
          min={0.5}
          max={2.2}
          step={0.05}
          value={touchScale}
          onInput={(e) =>
            setProfileSettings(
              mergeScopedDial(scope, profileSettings, plan.targetKey, {
                touchScale: Number((e.currentTarget as HTMLInputElement).value)
              })
            )
          }
          style={{ flex: 1 }}
        />
        <span style={{ width: "32px", textAlign: "right" }}>{touchScale.toFixed(2)}</span>
      </label>
      <label style={rowStyle}>
        <span style={labelStyle}>{t("scale.type")}</span>
        <input
          type="range"
          min={0.8}
          max={1.5}
          step={0.05}
          value={typeScale}
          onInput={(e) =>
            setProfileSettings(
              mergeScopedDial(scope, profileSettings, plan.targetKey, {
                typeScale: Number((e.currentTarget as HTMLInputElement).value)
              })
            )
          }
          style={{ flex: 1 }}
        />
        <span style={{ width: "32px", textAlign: "right" }}>{typeScale.toFixed(2)}</span>
      </label>
      <label style={rowStyle}>
        <span style={labelStyle}>{t("scale.zoom")}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={displayZoom}
          onInput={(e) =>
            setProfileSettings(
              mergeScopedDial(scope, profileSettings, plan.targetKey, {
                displayZoom: Number((e.currentTarget as HTMLInputElement).value)
              })
            )
          }
          style={{ flex: 1 }}
        />
        <span style={{ width: "32px", textAlign: "right" }}>{displayZoom.toFixed(2)}</span>
      </label>
      <span style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8, marginTop: "4px" }}>
        {t("scale.appearance")}
      </span>
      <label style={rowStyle}>
        <span style={labelStyle}>{t("scale.longText")}</span>
        <div style={{ display: "flex", gap: "4px", flex: 1 }}>
          {(["scroll", "wrap", "truncate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                writeTitleOverflow(m);
                setOverflowMode(m);
              }}
              style={{
                flex: 1,
                padding: "4px 6px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background:
                  overflowMode === m
                    ? "color-mix(in oklab, var(--primary) 22%, var(--card))"
                    : "transparent",
                color: "var(--foreground)",
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              {t(("app.overflow." + m) as never)}
            </button>
          ))}
        </div>
      </label>
      <span style={{ fontSize: "11px", opacity: 0.6 }}>
        {plan.ppi != null
          ? t("scale.ppiLine", {
              ppi: Math.round(plan.ppi),
              floor: plan.touchFloorPx,
              target: plan.touchTargetPx
            })
          : t("scale.noDiagonal", { floor: plan.touchFloorPx })}
      </span>
    </div>
  );
}

function PrimaryScreenToggle({
  value,
  onChange
}: {
  value: DeviceKindSetting;
  onChange: (next: DeviceKindSetting) => void;
}) {
  useLocale();
  const options: {
    id: DeviceKindSetting;
    label: string;
    icon: typeof Monitor | null;
  }[] = [
    { id: "auto", label: t("designer.screen.auto"), icon: null },
    { id: "panel", label: t("designer.screen.panel"), icon: Monitor },
    { id: "mobile", label: t("designer.screen.mobile"), icon: Smartphone },
    { id: "tablet", label: t("designer.screen.tablet"), icon: Tablet }
  ];

  return (
    <div className="designer-primary-screen" role="group" aria-label={t("designer.primaryScreen")}>
      <span className="designer-primary-screen-label">{t("designer.primaryScreen")}</span>
      <div className="designer-primary-screen-grid">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              className={
                value === option.id
                  ? "designer-primary-screen-btn designer-primary-screen-btn-active"
                  : "designer-primary-screen-btn"
              }
              aria-pressed={value === option.id}
              onClick={() => onChange(option.id)}
            >
              {Icon ? <Icon size={15} strokeWidth={2} aria-hidden /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OrientationToggle({
  value,
  onChange,
  disabled
}: {
  value: DisplayOrientation;
  onChange: (next: DisplayOrientation) => void;
  disabled: boolean;
}) {
  useLocale();
  return (
    <div className="designer-orientation" role="group" aria-label={t("designer.orientation")}>
      <button
        type="button"
        className={
          value === "landscape"
            ? "designer-orientation-btn designer-orientation-btn-active"
            : "designer-orientation-btn"
        }
        aria-pressed={value === "landscape"}
        disabled={disabled}
        onClick={() => onChange("landscape")}
      >
        <Monitor size={16} strokeWidth={2} />
        {t("designer.landscape")}
      </button>
      <button
        type="button"
        className={
          value === "portrait"
            ? "designer-orientation-btn designer-orientation-btn-active"
            : "designer-orientation-btn"
        }
        aria-pressed={value === "portrait"}
        disabled={disabled}
        onClick={() => onChange("portrait")}
      >
        <Smartphone size={16} strokeWidth={2} />
        {t("designer.portrait")}
      </button>
    </div>
  );
}

/** A visual target is just resolution x physical size (+ kind). No vendor,
 *  no hardware-timing identity - that is the runtime's concern, not the
 *  designer's. */
interface ScreenTarget {
  readonly label: string;
  readonly w: number;
  readonly h: number;
  readonly diagonalInches: number | null;
  readonly deviceKind: ResolvedDeviceKind;
}

function targetLabel(w: number, h: number, diag: number | null): string {
  return diag != null ? `${w}x${h} · ${diag}in` : `${w}x${h}`;
}

// Local mergeForTarget RETIRED: the display-prefs write path is the
// shared mergeProfileForTarget in designer-layout-io.ts - one bucket
// rule (target key when known, else custom), one implementation.

function DesignerSidebar({
  tab,
  buildPageId,
  onBuildPageChange,
  buildSelection,
  onBuildSelect
}: {
  tab: DesignerTab;
  buildPageId: string | null;
  onBuildPageChange: (pageId: string) => void;
  buildSelection: BuildSelection | null;
  onBuildSelect: (selection: BuildSelection | null) => void;
}) {
  useLocale();
  const {
    plan,
    profileSettings,
    deviceKindSetting,
    setDeviceKindSetting,
    setMatrixDeviceKind,
    setViewportOverride,
    setPresetId,
    setProfileSettings,
    setDiagonalInches
  } = usePresentation();
  const [orientation, setOrientation] = useState<DisplayOrientation>("landscape");
  const stageDrilled = useStageEditor().stagePageId !== null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<readonly DisplayPresetEntry[]>([]);
  const [pickMode, setPickMode] = useState<"res" | "size" | "custom">("res");
  const [customW, setCustomW] = useState("800");
  const [customH, setCustomH] = useState("480");
  const [customDiag, setCustomDiag] = useState("5");
  const [selected, setSelected] = useState<ScreenTarget>({
    label: "800x480 · 5in",
    w: 800,
    h: 480,
    diagonalInches: 5,
    deviceKind: "panel"
  });

  // The preset catalogue (~197 hardware presets, each carrying its own
  // physical diagonal) is the picker's source of truth. Loaded once; its
  // absence just falls back to manual scale on the Scale tab.
  useEffect(() => {
    let cancelled = false;
    void loadDisplayPresetCatalog()
      .then((c) => {
        if (!cancelled) {
          setCatalog(c.entries);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isSquare = selected.w === selected.h;
  const viewport = useMemo(() => {
    const long = Math.max(selected.w, selected.h);
    const short = Math.min(selected.w, selected.h);
    return orientation === "portrait"
      ? { widthPx: short, heightPx: long }
      : { widthPx: long, heightPx: short };
  }, [selected.w, selected.h, orientation]);

  // Vendor-free combos derived from the catalogue DATA: which (resolution,
  // size) pairs actually exist. Resolution normalised to long x short, so a
  // panel is identified by shape + diagonal, never by who made it.
  const combos = useMemo(() => {
    const resToSizes = new Map<string, number[]>();
    const sizeToRes = new Map<number, string[]>();
    const resWH = new Map<string, { w: number; h: number }>();
    const resCls = new Map<string, string>();
    for (const e of catalog) {
      if (e.diagonalInches == null) {
        continue;
      }
      const w = Math.max(e.widthPx, e.heightPx);
      const h = Math.min(e.widthPx, e.heightPx);
      const rk = `${w}x${h}`;
      resWH.set(rk, { w, h });
      resCls.set(rk, sizeClassFor(w, h));
      const sizes = resToSizes.get(rk) ?? [];
      if (!sizes.includes(e.diagonalInches)) {
        sizes.push(e.diagonalInches);
        sizes.sort((a, b) => a - b);
      }
      resToSizes.set(rk, sizes);
      const reses = sizeToRes.get(e.diagonalInches) ?? [];
      if (!reses.includes(rk)) {
        reses.push(rk);
      }
      sizeToRes.set(e.diagonalInches, reses);
    }
    const resList = Array.from(resWH.keys()).sort((a, b) => {
      const A = resWH.get(a)!;
      const B = resWH.get(b)!;
      return A.w * A.h - B.w * B.h;
    });
    const sizeList = Array.from(sizeToRes.keys()).sort((a, b) => a - b);
    return { resToSizes, sizeToRes, resWH, resCls, resList, sizeList };
  }, [catalog]);

  const choose = (
    w: number,
    h: number,
    diag: number | null,
    kind: ResolvedDeviceKind
  ) => {
    setSelected({ label: targetLabel(w, h, diag), w, h, diagonalInches: diag, deviceKind: kind });
    setPickerOpen(false);
  };

  // One effect feeds the whole plan from the chosen vendor-free target:
  // viewport (resolution), the true physical diagonal (which forms the
  // profile target key), and the device kind. No preset id - the designer
  // never cites hardware.
  useEffect(() => {
    setViewportOverride(viewport);
    setPresetId(null);
    setDiagonalInches(selected.diagonalInches);
    setMatrixDeviceKind(selected.deviceKind);
  }, [
    viewport.widthPx,
    viewport.heightPx,
    selected.label,
    selected.deviceKind,
    selected.diagonalInches,
    setViewportOverride,
    setPresetId,
    setDiagonalInches,
    setMatrixDeviceKind
  ]);

  // Restore a saved per-target device kind into the toggle when the chosen
  // target changes. The preview already resolves device kind from byTarget;
  // this keeps the toggle in sync. Keyed on targetKey only, so it never
  // fights a manual toggle within the same target.
  useEffect(() => {
    const stored =
      plan.targetKey != null
        ? profileSettings?.byTarget?.[plan.targetKey]?.deviceKind
        : undefined;
    if (stored != null) {
      setDeviceKindSetting(stored);
    }
  }, [plan.targetKey]); // eslint-disable-line

  const deviceKindStatus =
    plan.deviceKindSetting === "auto"
      ? t("designer.kindAuto", { kind: deviceKindLabel(plan.deviceKind) })
      : deviceKindLabel(plan.deviceKind);

  return (
    <aside className="designer-panel">
      <header className="designer-panel-head">
        <div className="designer-brand">
          <span className="designer-brand-mark" aria-hidden />
          <div>
            <h1 className="designer-panel-title">{t("designer.title")}</h1>
            <p className="designer-panel-lead">{t("designer.lead")}</p>
          </div>
        </div>
        <button
          type="button"
          className="designer-screen-chip"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
        >
          <span className="designer-screen-chip-label">{t("designer.currentScreen")}</span>
          <span className="designer-screen-chip-value">{selected.label}</span>
          <span className="designer-screen-chip-change">
            {t("designer.change")} <Search size={13} strokeWidth={2} aria-hidden />
          </span>
        </button>
      </header>

      <div className="designer-tab-body">
        {tab === "screen" ? (
          <>
            <PrimaryScreenToggle value={deviceKindSetting} onChange={setDeviceKindSetting} />
            <OrientationToggle
              value={orientation}
              onChange={setOrientation}
              disabled={isSquare}
            />
            <HomeStyleToggle />
            <p className="designer-tab-hint">{t("designer.catalogHint")}</p>
          </>
        ) : null}
        {tab === "scale" ? (
          <>
            <ScaleControls />
            <DensityControl />
          </>
        ) : null}
        {tab === "home" ? (
          <>
            <DesignerThemePicker />
            {plan.interaction === "pivot" ? (
              <DesignerCompassEditor />
            ) : (
              <>
                <FullLayoutNavGuide />
                <p className="designer-tab-hint">{t("designer.homeRailHint")}</p>
                <p className="designer-tab-hint">{t("designer.compactHomeHint")}</p>
              </>
            )}
          </>
        ) : null}
        {tab === "menu" ? <DesignerMenuEditor /> : null}
        {tab === "viz" ? (
          <p className="designer-tab-hint">{t("viz.hint")}</p>
        ) : null}
        {tab === "pages" && stageDrilled ? <DesignerStageOutline /> : null}
        {tab === "pages" && !stageDrilled ? (
          <DesignerPagesEditor
            pageId={buildPageId}
            onPageChange={onBuildPageChange}
            selection={buildSelection}
            onSelect={onBuildSelect}
          />
        ) : null}
      </div>

      <footer className="designer-panel-foot">
        {/* Apply lives in the top builder bar now (flat-navigation
            ruling); the footer keeps the status truth chips. */}
        <div className="designer-status-row">
          <span className="designer-status-chip designer-status-chip-primary">
            {formatResolution(viewport.widthPx, viewport.heightPx)}
          </span>
          <span className="designer-status-chip">
            {orientation === "landscape" ? t("designer.landscape") : t("designer.portrait")}
          </span>
          <span className="designer-status-chip">
            {plan.interaction === "pivot" ? t("designer.pivot") : t("compass.homeStyle.full")}
          </span>
          {plan.interaction === "pivot" ? (
            <span className="designer-status-chip">
              {plan.smallLanding === "compass"
                ? t("compass.landing.compass")
                : t("compass.landing.track")}
            </span>
          ) : null}
          <span className="designer-status-chip">{deviceKindStatus}</span>
          {plan.deviceKindSetting === "auto" ? (
            <span className="designer-status-chip designer-status-chip-muted">
              {t("designer.viaSource", { source: plan.deviceKindSource })}
            </span>
          ) : (
            <span className="designer-status-chip designer-status-chip-muted">
              {t("designer.kindSet", { kind: deviceKindSettingLabel(plan.deviceKindSetting) })}
            </span>
          )}
        </div>
      </footer>

      {pickerOpen ? (
        <div
          className="designer-picker-scrim"
          role="dialog"
          aria-modal="true"
          aria-label={t("designer.chooseScreen")}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPickerOpen(false);
            }
          }}
        >
          <div className="designer-picker">
            <div className="designer-picker-head">
              <span className="designer-picker-title">{t("designer.chooseScreen")}</span>
              <button
                type="button"
                className="designer-picker-close"
                aria-label={t("dialog.close")}
                onClick={() => setPickerOpen(false)}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="designer-picker-modes" role="tablist" aria-label={t("designer.pickBy")}>
              <button
                type="button"
                role="tab"
                aria-selected={pickMode === "res"}
                className={pickMode === "res" ? "designer-tab designer-tab-active" : "designer-tab"}
                onClick={() => setPickMode("res")}
              >
                {t("designer.resolutionFirst")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pickMode === "size"}
                className={pickMode === "size" ? "designer-tab designer-tab-active" : "designer-tab"}
                onClick={() => setPickMode("size")}
              >
                {t("designer.sizeFirst")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pickMode === "custom"}
                className={pickMode === "custom" ? "designer-tab designer-tab-active" : "designer-tab"}
                onClick={() => setPickMode("custom")}
              >
                {t("designer.custom")}
              </button>
            </div>
            <div className="designer-picker-list">
              {catalog.length === 0 && pickMode !== "custom" ? (
                <p className="designer-size-empty">{t("designer.loadingCatalog")}</p>
              ) : null}

              {pickMode === "res" ? (
                <ul className="designer-size-list-inner">
                  {combos.resList.map((rk) => {
                    const wh = combos.resWH.get(rk)!;
                    const sizes = combos.resToSizes.get(rk) ?? [];
                    return (
                      <li key={rk} className="designer-combo-row">
                        <div className="designer-combo-head">
                          <AspectGlyph widthPx={wh.w} heightPx={wh.h} active={false} />
                          <span className="designer-size-resolution">{rk}</span>
                          <span className="designer-size-meta">{combos.resCls.get(rk)}</span>
                        </div>
                        <div className="designer-picker-chips">
                          {sizes.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={
                                selected.w === wh.w &&
                                selected.h === wh.h &&
                                selected.diagonalInches === s
                                  ? "designer-chip designer-chip-active"
                                  : "designer-chip"
                              }
                              onClick={() => choose(wh.w, wh.h, s, "panel")}
                            >
                              {t("designer.inches", { n: s })}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {pickMode === "size" ? (
                <ul className="designer-size-list-inner">
                  {combos.sizeList.map((s) => {
                    const reses = combos.sizeToRes.get(s) ?? [];
                    return (
                      <li key={s} className="designer-combo-row">
                        <div className="designer-combo-head">
                          <span className="designer-size-resolution">
                            {t("designer.inches", { n: s })}
                          </span>
                          <span className="designer-size-meta">
                            {tn("designer.resolutionCount", reses.length)}
                          </span>
                        </div>
                        <div className="designer-picker-chips">
                          {reses.map((rk) => {
                            const wh = combos.resWH.get(rk)!;
                            return (
                              <button
                                key={rk}
                                type="button"
                                className={
                                  selected.w === wh.w &&
                                  selected.h === wh.h &&
                                  selected.diagonalInches === s
                                    ? "designer-chip designer-chip-active"
                                    : "designer-chip"
                                }
                                onClick={() => choose(wh.w, wh.h, s, "panel")}
                              >
                                {rk}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {pickMode === "custom" ? (
                <div className="designer-picker-custom">
                  <p className="designer-picker-step">{t("designer.customTarget")}</p>
                  <div className="designer-custom-row">
                    <label>
                      {t("designer.width")}
                      <input
                        type="number"
                        value={customW}
                        onInput={(e) => setCustomW((e.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                    <label>
                      {t("designer.height")}
                      <input
                        type="number"
                        value={customH}
                        onInput={(e) => setCustomH((e.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                    <label>
                      {t("scale.diagonalIn")}
                      <input
                        type="number"
                        step={0.1}
                        value={customDiag}
                        onInput={(e) => setCustomDiag((e.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="designer-chip"
                    onClick={() => {
                      const w = parseInt(customW, 10);
                      const h = parseInt(customH, 10);
                      const d = parseFloat(customDiag);
                      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                        choose(w, h, Number.isFinite(d) && d > 0 ? d : null, "panel");
                      }
                    }}
                  >
                    {t("designer.useThisTarget")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function DesignerPreviewFrame() {
  useLocale();
  const { viewportOverride } = usePresentation();
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const w = viewportOverride?.widthPx ?? 1280;
  const h = viewportOverride?.heightPx ?? 720;

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    const fit = () => {
      const pad = 56;
      const availW = Math.max(120, stage.clientWidth - pad);
      const availH = Math.max(120, stage.clientHeight - pad);
      const bezelW = w + 24;
      const bezelH = h + 24;
      setScale(Math.min(1, availW / bezelW, availH / bezelH));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [w, h]);

  return (
    <section className="designer-canvas" aria-label={t("designer.livePreview")}>
      <header className="designer-canvas-head">
        <span className="designer-canvas-label">{t("designer.livePreview")}</span>
        <span className="designer-canvas-badge">{formatResolution(w, h)}</span>
      </header>
      <div className="designer-canvas-stage" ref={stageRef}>
        <div className="designer-canvas-glow" aria-hidden />
        <div
          className="designer-device"
          style={{
            width: `${w + 24}px`,
            height: `${h + 24}px`,
            transform: `scale(${scale})`
          }}
        >
          <div className="designer-device-bezel">
            {/* The preview is an <iframe>, not a same-document div, so the
                rendered App gets a REAL viewport of exactly w x h. Every
                vh/vw/@media in the app's CSS then resolves against the
                panel, not the designer's desktop window - which is what
                makes the designer agree with the device. transform:scale()
                stays on the parent .designer-device for fit-to-window;
                scaling the iframe's pixels after layout is fine, it is the
                layout viewport that must be the panel. */}
            <iframe
              className="designer-device-screen"
              style={{
                width: `${w}px`,
                height: `${h}px`,
                border: "0",
                display: "block"
              }}
              src="/?embedded=1"
              title={t("designer.devicePreview")}
              data-test-viewport={`${w}x${h}`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function DisplayTestLab() {
  useEffect(() => {
    document.documentElement.classList.add("display-test-mode");
    return () => document.documentElement.classList.remove("display-test-mode");
  }, []);

  const client = useMemo(() => new GatewayClient(), []);

  return (
    <PresentationProvider
      initialViewportOverride={{ widthPx: 1280, heightPx: 720 }}
      initialPresetId={null}
      initialDeviceKindSetting="auto"
    >
      <DesignerScopeProvider>
        <DesignerHistoryProvider>
          <StageEditorProvider>
            <DesignerWorkshop client={client} />
          </StageEditorProvider>
        </DesignerHistoryProvider>
      </DesignerScopeProvider>
    </PresentationProvider>
  );
}

/** The two-scope selector: which screen the designer is editing.
 *  Native = the panel picked in the screen picker (per-target
 *  storage); Remote = the single browser-facing scope (remote slot,
 *  full-reference default). Every editor and the canvas route reads
 *  and writes by this value via designer-layout-io. */
function DesignerScopePicker(): JSX.Element {
  useLocale();
  const { scope, setScope } = useDesignerScope();
  return (
    <div className="designer-scope-picker" role="group" aria-label={t("designer.editingScope")}>
      {(["native", "remote"] as const).map((s) => (
        <button
          key={s}
          type="button"
          className={
            "designer-tab" + (scope === s ? " designer-tab-active" : "")
          }
          aria-pressed={scope === s}
          onClick={() => setScope(s)}
        >
          {s === "native" ? t("designer.nativeScreen") : t("designer.remoteScreen")}
        </button>
      ))}
    </div>
  );
}

/** The flat builder bar (page-builder ruling): one horizontal strip
 *  carrying the aspect tabs, the scope picker, undo/redo, and Apply -
 *  canvas-first, no deep tab stack in the sidebar. */
function DesignerTopBar({
  tab,
  onTabChange,
  onApply,
  applyState,
  applyMessage,
}: {
  tab: DesignerTab;
  onTabChange: (tab: DesignerTab) => void;
  onApply: () => void;
  applyState: DesignerApplyState;
  applyMessage: string | null;
}) {
  useLocale();
  const TABS: readonly [DesignerTab, string][] = [
    ["screen", t("designer.tab.screen")],
    ["scale", t("designer.tab.scale")],
    ["home", t("nav.home")],
    ["menu", t("menu.title")],
    ["pages", t("pages.title")],
    ["viz", t("viz.tab")],
    /* Stage tab RETIRED - drill in from a Now Playing widget on Pages. */
  ];
  return (
    <div className="designer-topbar">
      <div className="designer-tabs designer-tabs-bar" role="tablist" aria-label={t("designer.designAspect")}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "designer-tab designer-tab-active" : "designer-tab"}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="designer-topbar-spacer" />
      <DesignerScopePicker />
      <DesignerHistoryControls />
      {applyMessage ? (
        <span
          className={
            applyState === "error"
              ? "designer-topbar-message designer-apply-message-error"
              : "designer-topbar-message"
          }
          role={applyState === "error" ? "alert" : "status"}
          title={applyMessage}
        >
          {applyMessage}
        </span>
      ) : null}
      <button
        type="button"
        className="designer-apply-btn designer-apply-btn-bar"
        disabled={applyState === "saving"}
        title={t("designer.applyTitle")}
        onClick={() => void onApply()}
      >
        {designerApplyLabel(applyState)}
      </button>
      {/* Exit to the player. Essential for kiosk sessions that
        * entered via Settings -> Design (no tab chrome to close);
        * harmless convenience in a browser tab. */}
      <button
        type="button"
        className="designer-exit-btn"
        title={t("builder.exit")}
        aria-label={t("builder.exit")}
        onClick={() => {
          window.location.href = "/";
        }}
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

function DesignerWorkshop({ client }: { client: GatewayClient }) {
  const { applyState, applyMessage, applyPreviewProfile } = useDesignerProfileSync(client);
  const [tab, setTabRaw] = useState<DesignerTab>("screen");
  const [buildPageId, setBuildPageId] = useState<string | null>(null);
  const [buildSelection, setBuildSelection] = useState<BuildSelection | null>(null);
  const stageEd = useStageEditor();
  const stageDrilled = stageEd.stagePageId !== null;
  // Leaving Pages exits the drill - the breadcrumb never goes stale.
  const setTab = (next: DesignerTab) => {
    if (next !== "pages") stageEd.exitStage();
    setTabRaw(next);
  };

  return (
    <div className="designer-workshop theme-evo-default">
      <DesignerEmbedPublisher />
      <DesignerTopBar
        tab={tab}
        onTabChange={setTab}
        onApply={applyPreviewProfile}
        applyState={applyState}
        applyMessage={applyMessage}
      />
      <DesignerSidebar
        tab={tab}
        buildPageId={buildPageId}
        onBuildPageChange={setBuildPageId}
        buildSelection={buildSelection}
        onBuildSelect={setBuildSelection}
      />
      {tab === "pages" ? (
        stageDrilled ? (
          <DesignerStageCanvas />
        ) : (
          <DesignerBuildStage
            pageId={buildPageId}
            onPageChange={setBuildPageId}
            selection={buildSelection}
            onSelect={setBuildSelection}
          />
        )
      ) : tab === "viz" ? (
        <DesignerVisualizerStudio />
      ) : (
        <DesignerPreviewFrame />
      )}
    </div>
  );
}

/** Publishes the designer's live device profile to the same-origin embed
 *  channel the preview <iframe> reads. Sizing is intentionally omitted -
 *  the iframe element is sized to the panel, so the preview's own viewport
 *  already equals it; only the non-viewport profile travels the channel. */
function DesignerEmbedPublisher() {
  const { profileSettings, diagonalInches, deviceKindSetting, presetId } =
    usePresentation();
  const { scope } = useDesignerScope();
  useEffect(() => {
    writeEmbedProfile({
      profileSettings,
      diagonalInches,
      deviceKindSetting,
      presetId,
      scope
    });
  }, [profileSettings, diagonalInches, deviceKindSetting, presetId, scope]);
  return null;
}

export { isDesignerMode } from "./designer-mode";
