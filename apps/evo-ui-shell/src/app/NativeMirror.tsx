// /native opened from a remote browser: a true simulation of the
// attached glass, not a refolded layout. The real App runs inside an
// iframe fixed at the panel's exact resolution and scaled to fit
// this window with aspect preserved - what the panel renders is what
// you see, pixel geometry identical. The kiosk itself never sees this
// wrapper: on loopback the app renders fullscreen directly, and the
// inner frame carries ?mirror=1 so it cannot recurse.
//
// The panel's identity comes from device facts, not guesses: the
// device display preset (settings) resolved against the preset
// catalogue for WxH and diagonal. When the device has no selected
// display identity the wrapper says exactly that - no invented
// resolution.

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import {
  loadDisplayPresetCatalog,
  type DisplayPresetEntry
} from "../runtime/display-preset-catalog";
import { parseTargetKey } from "../runtime/presentation-target";
import { readDisplayPresetId, readNativeTargetKey } from "../runtime/ui-profile";

interface PanelIdentity {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly diagonalInches: number | null;
  readonly name: string;
}

type MirrorState =
  | { phase: "loading" }
  | { phase: "no-identity"; reason: string }
  | { phase: "ready"; panel: PanelIdentity };

async function fetchPanelIdentity(): Promise<MirrorState> {
  let settings: Record<string, unknown>;
  try {
    const res = await fetch("/api/ui/v1/settings");
    if (!res.ok) {
      return { phase: "no-identity", reason: `Device settings unavailable (HTTP ${res.status}).` };
    }
    const payload = (await res.json()) as { settings?: Record<string, unknown> };
    settings = payload.settings ?? {};
  } catch {
    return { phase: "no-identity", reason: "Device settings unreachable." };
  }
  // The wrapper wears the DEVICE's theme: without this it renders the
  // raw :root defaults (dark) around a themed iframe - "why is the
  // frame dark around my light app" incarnate.
  const theme = settings["ui.theme"];
  if (typeof theme === "string" && /^[a-z0-9-]+$/.test(theme)) {
    document.documentElement.className = `theme-${theme}`;
  }
  // Primary identity: the vendor-free declared target ("WxH@diag"),
  // written by the designer's Apply with a screen selected. The
  // hardware preset id remains a fallback for provisioned devices.
  const nativeTarget = readNativeTargetKey(settings);
  if (nativeTarget !== null) {
    const parsed = parseTargetKey(nativeTarget);
    if (parsed !== null) {
      return {
        phase: "ready",
        panel: {
          widthPx: parsed.widthPx,
          heightPx: parsed.heightPx,
          diagonalInches: parsed.diagonalInches,
          name: "declared screen"
        }
      };
    }
  }
  const presetId = readDisplayPresetId(settings);
  if (presetId === null) {
    return {
      phase: "no-identity",
      reason:
        "The device has no declared screen - apply once in the designer with the attached screen selected, then reload. Until then there is no native identity to mirror."
    };
  }
  let entry: DisplayPresetEntry | undefined;
  try {
    const catalog = await loadDisplayPresetCatalog();
    entry = catalog.entries.find((e) => e.id === presetId);
  } catch {
    entry = undefined;
  }
  if (entry === undefined) {
    return {
      phase: "no-identity",
      reason: `Display preset "${presetId}" is not in the catalogue - cannot derive the panel geometry.`
    };
  }
  return {
    phase: "ready",
    panel: {
      widthPx: entry.widthPx,
      heightPx: entry.heightPx,
      diagonalInches: entry.diagonalInches,
      name: entry.name
    }
  };
}

export function NativeMirror(): JSX.Element {
  const [state, setState] = useState<MirrorState>({ phase: "loading" });
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void fetchPanelIdentity().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const panel = state.phase === "ready" ? state.panel : null;

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || panel === null) {
      return;
    }
    const fit = () => {
      const pad = 24;
      const availW = Math.max(120, stage.clientWidth - pad);
      const availH = Math.max(120, stage.clientHeight - pad);
      setScale(Math.min(availW / panel.widthPx, availH / panel.heightPx));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [panel]);

  return (
    <div className="native-mirror">
      <p className="native-mirror-caption">
        {panel !== null
          ? `Native screen - ${panel.name}, ${panel.widthPx}x${panel.heightPx}` +
            (panel.diagonalInches !== null ? ` @ ${panel.diagonalInches}"` : "") +
            " - live simulation of the attached glass"
          : state.phase === "loading"
            ? "Reading the device's display identity..."
            : "Native screen unavailable"}
      </p>
      <div className="native-mirror-stage" ref={stageRef}>
        {panel !== null ? (
          <iframe
            className="native-mirror-frame"
            title="Native screen"
            src="/native?mirror=1"
            width={panel.widthPx}
            height={panel.heightPx}
            style={{
              width: `${panel.widthPx}px`,
              height: `${panel.heightPx}px`,
              transform: `scale(${scale})`
            }}
          />
        ) : state.phase === "no-identity" ? (
          <p className="native-mirror-empty">{state.reason}</p>
        ) : null}
      </div>
    </div>
  );
}
