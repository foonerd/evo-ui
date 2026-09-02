// Stage document v2 - the now-playing surface as operator data.
//
// FINAL GRAMMAR (v5 contract, Elementor-shaped, locked 2026-07-13):
//   SECTION  full-width band; height weight; fold priority
//   COLUMN   fraction split inside a section (weights = fractions)
//   ROW      any count per column; height weight
//   CELL     any count per row; width weight; h/v alignment
//   CONTENT  atoms live ONLY in cells and flow inline (wrapping);
//            vertical stacking is expressed as separate rows.
// SPACER is ordinary content with a weight - invisible on glass,
// hatched in the designer. NAV is a menu icon atom.
//
// Contract atoms (title, artist, play, volume) are presence-locked:
// decode GUARANTEES them by appending a never-folding section.
// Sections shed lowest fold-priority first on short glass.
//
// LEGACY UPGRADE: v1 documents (rows -> cells -> stacked blocks) are
// upgraded on decode - each v1 row becomes a section; each v1 cell
// becomes a column (stacked blocks -> one row per block; inline
// cells -> a single cell holding the line). One canonical runtime
// form; the stored data keeps working without migration scripts.

export type StageAtomKind =
  | "art" | "title" | "artist" | "album" | "classical"
  | "viz" | "progress"
  | "play" | "prev" | "next" | "shuffle" | "repeat1" | "repeatAll" | "fav"
  | "volume" | "codec" | "bitrate" | "nav" | "spacer"
  | "bio" | "notes" | "lyrics" | "provenance" | "smart" | "tabbed";

export const STAGE_ATOM_KINDS: readonly StageAtomKind[] = [
  "art", "title", "artist", "album", "classical", "viz", "progress",
  "play", "prev", "next", "shuffle", "repeat1", "repeatAll", "fav",
  "volume", "codec", "bitrate", "nav", "spacer",
  "bio", "notes", "lyrics", "provenance", "smart", "tabbed",
];

export const STAGE_CONTRACT_ATOMS: ReadonlySet<StageAtomKind> = new Set([
  "title", "artist", "play", "volume",
] as StageAtomKind[]);

export type StageScale = 1 | 2 | 3;
export type StageHAlign = "left" | "center" | "right" | "justify";
export type StageVAlign = "top" | "center" | "bottom";

/* ---- v2.1 FULL CONTROLS (ruled 2026-07-14): padding, node scale,
   curated style - on EVERY structure node, all data, no CSS. ---- */

/** Inner padding in steps (1 step = 0.25rem). A single number pads
 *  all four sides; the object form is per-side top/right/bottom/left
 *  (granular control, by ruling). 0/absent = none. */
export type StagePad =
  | number
  | { readonly t: number; readonly r: number; readonly b: number; readonly l: number };

/** Curated style tokens. The THEME keeps palette authority - these
 *  pick tokens, never raw colors/CSS (accepted style-layer
 *  contract). Absent field = default (none / square / opaque). */
export interface StageStyle {
  readonly bg?: "panel" | "card" | "tint";
  readonly bd?: "hairline" | "accent";
  /** Corner radius step 1..3 (0 = absent). */
  readonly rad?: 1 | 2 | 3;
  /** Opacity percent below 100. */
  readonly op?: 85 | 70 | 50;
}

/** Controls shared by section/column/row/cell. `scale` is a percent
 *  (50..200, step 10); type, icons, artwork and controls inside all
 *  follow, and scales COMPOUND down the tree (em cascade).
 *  100/absent = neutral. */
export interface StageNodeControls {
  readonly pad?: StagePad;
  readonly scale?: number;
  readonly style?: StageStyle;
}

export interface StageBlock {
  readonly kind: StageAtomKind;
  /** Style scale step S/M/L. Default 2. */
  readonly scale?: StageScale;
}

export interface StageCell extends StageNodeControls {
  readonly weight: number;
  /** Horizontal alignment of the cell's content line. Default center. */
  readonly ha?: StageHAlign;
  /** Vertical alignment. Default center. */
  readonly va?: StageVAlign;
  readonly atoms: readonly StageBlock[];
}

export interface StageRow extends StageNodeControls {
  readonly weight: number;
  readonly cells: readonly StageCell[];
}

export interface StageColumn extends StageNodeControls {
  readonly weight: number;
  readonly rows: readonly StageRow[];
}

export interface StageSection extends StageNodeControls {
  readonly weight: number;
  /** 1..5; sections shed lowest first on short glass. 5 never sheds. */
  readonly foldPriority: number;
  readonly cols: readonly StageColumn[];
}

export interface StageDoc {
  readonly sections: readonly StageSection[];
}

/* helpers to write documents tersely */
const cell = (atoms: StageBlock[], weight = 1, ha?: StageHAlign, va?: StageVAlign): StageCell =>
  ({ weight, ...(ha ? { ha } : {}), ...(va ? { va } : {}), atoms });
const row = (cells: StageCell[], weight = 1): StageRow => ({ weight, cells });
const col = (rows: StageRow[], weight = 1): StageColumn => ({ weight, rows });
const sec = (cols: StageColumn[], weight = 1, foldPriority = 3): StageSection =>
  ({ weight, foldPriority, cols });
const a = (kind: StageAtomKind, scale?: StageScale): StageBlock =>
  ({ kind, ...(scale ? { scale } : {}) });

/** The shipped arrangement - today's stage in sections form. */
export const CLASSIC_STAGE: StageDoc = {
  sections: [
    sec([col([row([cell([a("title", 3)])])])], 1, 5),
    sec(
      [
        col([
          row([cell([a("art")])], 3),
          row([cell([a("codec", 1), a("bitrate", 1)])], 1),
        ], 2),
        col(
          [
            row([cell([a("artist")])]),
            row([cell([a("album")])]),
            row([cell([a("classical")])]),
            row([cell([a("viz")])], 2),
          ],
          3
        ),
      ],
      5, 5
    ),
    sec([col([row([cell([a("progress")])])])], 1, 4),
    sec(
      [col([row([cell([
        a("shuffle", 1), a("prev"), a("play", 3), a("next"), a("repeatAll", 1),
      ])])])],
      1, 5
    ),
    sec([col([row([cell([a("volume")])])])], 1, 3),
  ],
};

/* ------------------------- decode ------------------------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isAtom(v: unknown): v is StageAtomKind {
  return typeof v === "string" && (STAGE_ATOM_KINDS as readonly string[]).includes(v);
}
function wgt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.2
    ? Math.min(24, Math.round(v * 4) / 4)
    : 1;
}
function fold(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(5, Math.max(1, Math.round(v)))
    : 3;
}
function decodeBlock(v: unknown): StageBlock | null {
  if (!isObj(v) || !isAtom(v.kind)) return null;
  const s = v.scale;
  return { kind: v.kind, ...(s === 1 || s === 2 || s === 3 ? { scale: s } : {}) };
}

/* ---- v2.1 control decoders: tolerant, defaults OMITTED so stored
   documents stay minimal and the classic default stays byte-stable. */
function padStep(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(8, Math.max(0, Math.round(v)))
    : 0;
}
function decodePad(v: unknown): StagePad | undefined {
  if (typeof v === "number") {
    const n = padStep(v);
    return n === 0 ? undefined : n;
  }
  if (isObj(v)) {
    const t = padStep(v.t), r = padStep(v.r), b = padStep(v.b), l = padStep(v.l);
    if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
    if (t === r && r === b && b === l) return t; // collapse to common
    return { t, r, b, l };
  }
  return undefined;
}
function decodeNodeScale(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const s = Math.min(200, Math.max(50, Math.round(v / 10) * 10));
  return s === 100 ? undefined : s;
}
function decodeStyle(v: unknown): StageStyle | undefined {
  if (!isObj(v)) return undefined;
  const bg = v.bg === "panel" || v.bg === "card" || v.bg === "tint" ? v.bg : undefined;
  const bd = v.bd === "hairline" || v.bd === "accent" ? v.bd : undefined;
  const rad = v.rad === 1 || v.rad === 2 || v.rad === 3 ? v.rad : undefined;
  const op = v.op === 85 || v.op === 70 || v.op === 50 ? v.op : undefined;
  if (bg === undefined && bd === undefined && rad === undefined && op === undefined)
    return undefined;
  return {
    ...(bg !== undefined ? { bg } : {}),
    ...(bd !== undefined ? { bd } : {}),
    ...(rad !== undefined ? { rad } : {}),
    ...(op !== undefined ? { op } : {}),
  };
}
function decodeControls(v: Record<string, unknown>): StageNodeControls {
  const pad = decodePad(v.pad);
  const scale = decodeNodeScale(v.scale);
  const style = decodeStyle(v.style);
  return {
    ...(pad !== undefined ? { pad } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(style !== undefined ? { style } : {}),
  };
}

function decodeCell(v: unknown): StageCell | null {
  if (!isObj(v) || !Array.isArray(v.atoms)) return null;
  const atoms = v.atoms.map(decodeBlock).filter((x): x is StageBlock => x !== null);
  const ha = v.ha;
  const va = v.va;
  return {
    weight: wgt(v.weight),
    ...(ha === "left" || ha === "center" || ha === "right" || ha === "justify" ? { ha } : {}),
    ...(va === "top" || va === "center" || va === "bottom" ? { va } : {}),
    ...decodeControls(v),
    atoms,
  };
}

/** Upgrade one v1 row {weight,foldPriority,cells:[{weight,flow?,blocks}]}
 *  to a section: each v1 cell -> a column; stacked blocks -> one row
 *  per block; inline cells -> a single line cell. */
function upgradeLegacyRow(v: Record<string, unknown>): StageSection | null {
  if (!Array.isArray(v.cells)) return null;
  const cols: StageColumn[] = [];
  for (const cRaw of v.cells) {
    if (!isObj(cRaw) || !Array.isArray(cRaw.blocks)) continue;
    const blocks = cRaw.blocks.map(decodeBlock).filter((x): x is StageBlock => x !== null);
    const rows: StageRow[] =
      cRaw.flow === "inline"
        ? [row([cell(blocks)])]
        : blocks.map((b) => row([cell([b])]));
    cols.push(col(rows.length > 0 ? rows : [row([cell([])])], wgt(cRaw.weight)));
  }
  if (cols.length === 0) return null;
  return { weight: wgt(v.weight), foldPriority: fold(v.foldPriority), cols };
}

/** Tolerant decode of v2 (sections) OR v1 (rows) documents; null for
 *  non-documents. Contract atoms guaranteed. */
export function decodeStageDoc(raw: unknown): StageDoc | null {
  if (!isObj(raw)) return null;

  if (Array.isArray(raw.sections)) {
    const sections: StageSection[] = [];
    for (const sRaw of raw.sections) {
      if (!isObj(sRaw) || !Array.isArray(sRaw.cols)) continue;
      const cols: StageColumn[] = [];
      for (const cRaw of sRaw.cols) {
        if (!isObj(cRaw) || !Array.isArray(cRaw.rows)) continue;
        const rows: StageRow[] = [];
        for (const rRaw of cRaw.rows) {
          if (!isObj(rRaw) || !Array.isArray(rRaw.cells)) continue;
          const cells = rRaw.cells.map(decodeCell).filter((x): x is StageCell => x !== null);
          if (cells.length > 0)
            rows.push({ weight: wgt(rRaw.weight), ...decodeControls(rRaw), cells });
        }
        if (rows.length > 0)
          cols.push({ weight: wgt(cRaw.weight), ...decodeControls(cRaw), rows });
      }
      if (cols.length > 0)
        sections.push({
          weight: wgt(sRaw.weight),
          foldPriority: fold(sRaw.foldPriority),
          ...decodeControls(sRaw),
          cols,
        });
    }
    if (sections.length === 0) return null;
    return ensureStageContracts({ sections });
  }

  if (Array.isArray(raw.rows)) {
    // v1 document - upgrade.
    const sections = raw.rows
      .map((r) => (isObj(r) ? upgradeLegacyRow(r) : null))
      .filter((x): x is StageSection => x !== null);
    if (sections.length === 0) return null;
    return ensureStageContracts({ sections });
  }

  return null;
}

/** Append any missing contract atoms in a synthesized never-folding
 *  section - stored data can never erase playback control. */
export function ensureStageContracts(doc: StageDoc): StageDoc {
  const present = new Set<StageAtomKind>();
  for (const s of doc.sections)
    for (const c of s.cols)
      for (const r of c.rows)
        for (const l of r.cells)
          for (const b of l.atoms) present.add(b.kind);
  const missing = [...STAGE_CONTRACT_ATOMS].filter((k) => !present.has(k));
  if (missing.length === 0) return doc;
  return {
    sections: [
      ...doc.sections,
      sec([col([row([cell(missing.map((kind) => ({ kind })))])])], 1, 5),
    ],
  };
}

/* ------------------- v2.1 presentation mapping ------------------- */

/** Map a node's controls onto CSS declarations. ONE truth: the glass
 *  renderer and the designer canvas both call this, so what the
 *  operator sees in the builder is what the panel renders. Colors
 *  resolve through THEME tokens - the style layer picks tokens, the
 *  theme keeps palette authority. Scale uses font-size percent so it
 *  compounds down the tree through the em-based stage sizing. */
const STAGE_BG: Record<NonNullable<StageStyle["bg"]>, string> = {
  panel: "color-mix(in oklab, var(--card) 60%, transparent)",
  card: "var(--card)",
  tint: "color-mix(in oklab, var(--accent) 12%, transparent)",
};
const STAGE_BD: Record<NonNullable<StageStyle["bd"]>, string> = {
  hairline: "1px solid var(--border)",
  accent: "1px solid color-mix(in oklab, var(--accent) 70%, transparent)",
};
const STAGE_RAD = ["0", "0.375rem", "0.75rem", "1.25rem"] as const;
const padRem = (steps: number): string => `${steps * 0.25}rem`;

export function stageNodeCss(node: StageNodeControls): Record<string, string> {
  const css: Record<string, string> = {};
  if (node.pad !== undefined) {
    css.padding =
      typeof node.pad === "number"
        ? padRem(node.pad)
        : `${padRem(node.pad.t)} ${padRem(node.pad.r)} ${padRem(node.pad.b)} ${padRem(node.pad.l)}`;
  }
  if (node.scale !== undefined) css.fontSize = `${node.scale}%`;
  const st = node.style;
  if (st !== undefined) {
    if (st.bg !== undefined) css.background = STAGE_BG[st.bg];
    if (st.bd !== undefined) css.border = STAGE_BD[st.bd];
    if (st.rad !== undefined) css.borderRadius = STAGE_RAD[st.rad];
    if (st.op !== undefined) css.opacity = String(st.op / 100);
  }
  return css;
}

/** Sections visible when only `maxSections` fit: shed lowest fold
 *  priority first (5 never sheds); ties shed bottom-most first. */
export function stageSectionsVisible(
  doc: StageDoc,
  maxSections: number
): readonly StageSection[] {
  if (doc.sections.length <= maxSections) return doc.sections;
  const order = doc.sections
    .map((s, i) => ({ i, p: s.foldPriority }))
    .filter((x) => x.p < 5)
    .sort((x, y) => x.p - y.p || y.i - x.i);
  const shed = new Set<number>();
  for (const { i } of order) {
    if (doc.sections.length - shed.size <= maxSections) break;
    shed.add(i);
  }
  return doc.sections.filter((_, i) => !shed.has(i));
}
