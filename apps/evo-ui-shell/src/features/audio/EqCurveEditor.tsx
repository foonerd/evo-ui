// EqCurveEditor - the parametric-EQ response-curve editor.
//
// A controlled component: the parent owns the 10 bands and the
// selected index. Dragging a handle reports a new frequency + gain
// via onBandChange; the Q slider reports a new Q for the selected
// band. The summed peaking response is drawn as the curve. When
// `engaged` is false the curve is dimmed and dashed - the bands are
// still configured, just not applied.

import { useRef } from "preact/hooks";
import {
  eqResponseDb,
  clampEqBand,
  EQ_FREQ_MIN,
  EQ_FREQ_MAX,
  EQ_GAIN_MIN,
  EQ_GAIN_MAX,
  EQ_Q_MIN,
  EQ_Q_MAX,
  type EqBand
} from "./eq-decoders";

interface EqCurveEditorProps {
  bands: ReadonlyArray<EqBand>;
  selectedIndex: number;
  engaged: boolean;
  /** True while a transition / gesture locks the controls. */
  disabled: boolean;
  onSelect: (index: number) => void;
  onBandChange: (index: number, band: EqBand) => void;
}

// SVG plot geometry (viewBox units). The horizontal gutters are
// symmetric (PL on the left, VW - PR equal on the right) so the
// plot is centred in the viewBox: the dB labels sit cleanly in the
// left gutter and the extreme Hz labels (20 / 20k) get matching
// room and do not clip.
const VW = 640;
const VH = 264;
const PL = 40;
const PR = 600;
const PT = 14;
const PB = 226;
const PW = PR - PL;
const MID = (PT + PB) / 2;
const HH = (PB - PT) / 2;
const LMIN = Math.log(EQ_FREQ_MIN);
const LMAX = Math.log(EQ_FREQ_MAX);
const LSPAN = LMAX - LMIN;

const xOfFreq = (f: number): number =>
  PL + ((Math.log(f) - LMIN) / LSPAN) * PW;
const freqOfX = (x: number): number =>
  Math.exp(LMIN + ((x - PL) / PW) * LSPAN);
const yOfGain = (g: number): number => MID - (g / EQ_GAIN_MAX) * HH;
const gainOfY = (y: number): number => ((MID - y) / HH) * EQ_GAIN_MAX;
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const FREQ_GRID = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_GRID = [15, 10, 5, 0, -5, -10, -15];

function freqLabel(hz: number): string {
  return hz >= 1000
    ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz`
    : `${Math.round(hz)} Hz`;
}

export function EqCurveEditor({
  bands,
  selectedIndex,
  engaged,
  disabled,
  onSelect,
  onBandChange
}: EqCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<number>(-1);

  // Summed-response curve path.
  let curve = "";
  for (let x = PL; x <= PR; x += 3) {
    const db = engaged ? eqResponseDb(bands, freqOfX(x)) : 0;
    const y = clamp(yOfGain(db), PT, PB);
    curve += `${curve === "" ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  const pointerToBand = (ev: PointerEvent): { freqHz: number; gainDb: number } => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const rw = rect && rect.width > 0 ? rect.width : VW;
    const rh = rect && rect.height > 0 ? rect.height : VH;
    const px = ((ev.clientX - (rect?.left ?? 0)) / rw) * VW;
    const py = ((ev.clientY - (rect?.top ?? 0)) / rh) * VH;
    return {
      freqHz: Math.round(
        clamp(freqOfX(clamp(px, PL, PR)), EQ_FREQ_MIN, EQ_FREQ_MAX)
      ),
      gainDb:
        Math.round(clamp(gainOfY(clamp(py, PT, PB)), EQ_GAIN_MIN, EQ_GAIN_MAX) * 10) /
        10
    };
  };

  const onHandleDown = (index: number) => (ev: PointerEvent): void => {
    if (disabled) return;
    dragRef.current = index;
    onSelect(index);
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: PointerEvent): void => {
    const i = dragRef.current;
    if (i < 0 || disabled) return;
    const moved = pointerToBand(ev);
    onBandChange(i, clampEqBand({ ...bands[i], ...moved }));
  };
  const onPointerUp = (): void => {
    dragRef.current = -1;
  };

  const sel = bands[selectedIndex] ?? bands[0];

  return (
    <div className="audio-eq-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        className="audio-eq-svg"
        role="img"
        aria-label="Parametric EQ response curve with 10 draggable bands"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {FREQ_GRID.map((f) => (
          <g key={`f${f}`}>
            <line
              x1={xOfFreq(f)}
              y1={PT}
              x2={xOfFreq(f)}
              y2={PB}
              className="audio-eq-grid"
            />
            <text
              x={xOfFreq(f)}
              y={PB + 16}
              // Kebab-case is required: Preact passes SVG attribute names
              // through verbatim, so camelCase "textAnchor" is a no-op and
              // the label silently falls back to text-anchor: start.
              text-anchor="middle"
              className="audio-eq-axis"
            >
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          </g>
        ))}
        {DB_GRID.map((d) => (
          <g key={`d${d}`}>
            <line
              x1={PL}
              y1={yOfGain(d)}
              x2={PR}
              y2={yOfGain(d)}
              className={d === 0 ? "audio-eq-grid audio-eq-grid-zero" : "audio-eq-grid"}
            />
            <text
              x={PL - 6}
              y={yOfGain(d) + 3}
              // Kebab-case (see Hz label above): end-anchors the dB number
              // in the left gutter, so it sits before the grid edge at PL.
              text-anchor="end"
              className="audio-eq-axis"
            >
              {d > 0 ? `+${d}` : d}
            </text>
          </g>
        ))}
        <path
          d={curve}
          className={
            engaged ? "audio-eq-curve" : "audio-eq-curve audio-eq-curve-off"
          }
        />
        {bands.map((b, i) => (
          <circle
            key={i}
            cx={xOfFreq(b.freqHz)}
            cy={yOfGain(b.gainDb)}
            r={i === selectedIndex ? 8 : 6}
            className={
              i === selectedIndex
                ? "audio-eq-handle audio-eq-handle-on"
                : "audio-eq-handle"
            }
            onPointerDown={onHandleDown(i)}
          />
        ))}
      </svg>

      <div className="audio-eq-readout">
        <span className="audio-eq-readout-band">
          Band {selectedIndex + 1}
        </span>
        <span className="audio-eq-readout-field">
          Frequency{" "}
          <strong>{freqLabel(sel.freqHz)}</strong>
        </span>
        <span className="audio-eq-readout-field">
          Gain{" "}
          <strong>
            {sel.gainDb >= 0 ? "+" : ""}
            {sel.gainDb.toFixed(1)} dB
          </strong>
        </span>
        <label className="audio-eq-readout-q">
          <span>Q</span>
          <input
            type="range"
            min={EQ_Q_MIN}
            max={EQ_Q_MAX}
            step={0.1}
            value={sel.q}
            disabled={disabled}
            onInput={(ev) =>
              onBandChange(
                selectedIndex,
                clampEqBand({
                  ...sel,
                  q: Number((ev.currentTarget as HTMLInputElement).value)
                })
              )
            }
          />
          <strong>{sel.q.toFixed(1)}</strong>
        </label>
      </div>
    </div>
  );
}
