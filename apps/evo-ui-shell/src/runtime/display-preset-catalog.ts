// Parse display_presets.json entries into effective landscape W×H for UI testing.

export interface DisplayPresetEntry {
  readonly id: string;
  readonly name: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly diagonalInches: number | null;
  readonly source: "rotated" | "native" | "video_mode" | "fallback";
}

export interface DisplayPresetCatalog {
  readonly version: string;
  readonly entries: readonly DisplayPresetEntry[];
}

interface RawPreset {
  readonly name?: string;
  readonly description?: string;
  readonly native_resolution?: string;
  readonly rotated_resolution?: string;
  readonly video_mode?: string;
  /** Explicit verified physical diagonal in inches. Preferred over
   *  any value parsed from the name/description. Null/absent for
   *  generic or custom presets whose hardware size is unknown. */
  readonly diagonal_inches?: number;
}

interface RawCatalog {
  readonly version?: string;
  readonly presets?: Record<string, RawPreset>;
}

const SKIP_IDS = new Set([
  "auto",
  "custom-hdmi",
  "custom-dsi",
  "custom-dpi",
  "vga666"
]);

/** Parse `WxH` or `WxH@Hz` strings. */
export function parseResolutionPair(raw: string): { w: number; h: number } | null {
  const cleaned = raw.trim().split("@")[0] ?? "";
  const match = /^(\d+)\s*[x×]\s*(\d+)/i.exec(cleaned);
  if (match === null) {
    return null;
  }
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { w, h };
}

/** Extract a physical diagonal in inches from free text. Accepts a
 *  straight-quote form (`4.3"`), a spelled unit (`2.1-inch`,
 *  `2.1 inch`) or a hyphenated short form (`5-in`). Returns null when
 *  no inch-tagged number is present, so a bare resolution like
 *  "1080p" never reads as a diagonal. */
export function parseDiagonalInches(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(?:"|-?\s*inch\b|-in\b)/i.exec(text);
  if (match === null) {
    return null;
  }
  const inches = Number(match[1]);
  return Number.isFinite(inches) ? inches : null;
}

/** Resolve a preset's diagonal: explicit verified field first, then
 *  the name, then the description. Generic/custom presets with no
 *  inch anywhere resolve to null (operator sets size in the designer). */
export function resolveDiagonalInches(preset: RawPreset): number | null {
  if (typeof preset.diagonal_inches === "number" && Number.isFinite(preset.diagonal_inches)) {
    return preset.diagonal_inches;
  }
  return (
    parseDiagonalInches(preset.name ?? "") ??
    parseDiagonalInches(preset.description ?? "")
  );
}

function pickEffectiveResolution(preset: RawPreset): {
  w: number;
  h: number;
  source: DisplayPresetEntry["source"];
} | null {
  const rotated = preset.rotated_resolution
    ? parseResolutionPair(preset.rotated_resolution)
    : null;
  if (rotated !== null) {
    return { ...rotated, source: "rotated" };
  }
  const native = preset.native_resolution
    ? parseResolutionPair(preset.native_resolution)
    : null;
  if (native !== null) {
    return { ...native, source: "native" };
  }
  const video = preset.video_mode ? parseResolutionPair(preset.video_mode) : null;
  if (video !== null) {
    return { w: video.w, h: video.h, source: "video_mode" };
  }
  return null;
}

export function parseDisplayPresetCatalog(raw: unknown): DisplayPresetCatalog {
  const catalog = raw as RawCatalog;
  const entries: DisplayPresetEntry[] = [];
  const presets = catalog.presets ?? {};
  for (const [id, preset] of Object.entries(presets)) {
    if (id.startsWith("_comment") || SKIP_IDS.has(id)) {
      continue;
    }
    const resolved = pickEffectiveResolution(preset);
    if (resolved === null) {
      continue;
    }
    const name = preset.name ?? id;
    entries.push({
      id,
      name,
      widthPx: resolved.w,
      heightPx: resolved.h,
      diagonalInches: resolveDiagonalInches(preset),
      source: resolved.source
    });
  }
  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return {
    version: catalog.version ?? "unknown",
    entries
  };
}

export async function loadDisplayPresetCatalog(
  url = "/display-presets.json"
): Promise<DisplayPresetCatalog> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load display presets (${response.status})`);
  }
  return parseDisplayPresetCatalog(await response.json());
}

/** Key sizes from DISPLAY_RESOLUTIONS.md §A — quick manual test picks. */
export const MATRIX_QUICK_TESTS = [
  { label: "480×272 wearable strip", w: 480, h: 272 },
  { label: "640×480 small stack", w: 640, h: 480 },
  { label: "800×480 split cluster", w: 800, h: 480 },
  { label: "1480×320 bar", w: 1480, h: 320 },
  { label: "1280×720 full / 7K", w: 1280, h: 720 },
  { label: "1920×1080 full HD", w: 1920, h: 1080 },
  { label: "3840×2160 cinema", w: 3840, h: 2160 }
] as const;
