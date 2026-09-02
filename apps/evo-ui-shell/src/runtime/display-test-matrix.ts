/** Known display sizes — DISPLAY_RESOLUTIONS.md §A master test matrix (67). */

import type { ResolvedDeviceKind } from "./presentation-target.ts";

export type DisplaySizeClass = "wearable" | "small" | "standard";

export interface DisplayMatrixEntry {
  readonly id: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sizeClass: DisplaySizeClass;
  readonly deviceKind: ResolvedDeviceKind;
  /** Short friendly label (not engineering jargon). */
  readonly label: string;
}

function entry(
  widthPx: number,
  heightPx: number,
  sizeClass: DisplaySizeClass,
  label: string,
  deviceKind: ResolvedDeviceKind = "panel"
): DisplayMatrixEntry {
  return {
    id: `${widthPx}x${heightPx}`,
    widthPx,
    heightPx,
    sizeClass,
    deviceKind,
    label
  };
}

/** Sorted smallest area first — matches catalogue §A. */
export const DISPLAY_TEST_MATRIX: readonly DisplayMatrixEntry[] = [
  entry(320, 240, "wearable", "Small square"),
  entry(480, 272, "wearable", "Compact wide"),
  entry(480, 320, "wearable", "Compact"),
  entry(360, 640, "small", "Phone portrait", "mobile"),
  entry(480, 480, "wearable", "Square mini"),
  entry(640, 360, "wearable", "Wide mini"),
  entry(375, 667, "small", "Phone", "mobile"),
  entry(480, 640, "small", "Portrait stack"),
  entry(640, 480, "small", "Small panel"),
  entry(390, 844, "small", "Tall phone", "mobile"),
  entry(600, 600, "small", "Square"),
  entry(414, 896, "small", "Large phone", "mobile"),
  entry(480, 800, "small", "Tall panel"),
  entry(800, 480, "standard", "Split panel"),
  entry(480, 854, "small", "Android portrait", "mobile"),
  entry(854, 480, "standard", "Wide panel"),
  entry(1480, 320, "standard", "Ultra-wide bar"),
  entry(800, 600, "standard", "SVGA"),
  entry(1280, 400, "standard", "Wide bar"),
  entry(540, 960, "small", "qHD portrait", "mobile"),
  entry(720, 720, "standard", "Square kiosk"),
  entry(960, 540, "standard", "qHD"),
  entry(960, 544, "standard", "Wide split"),
  entry(1420, 380, "standard", "Dev bar"),
  entry(1024, 600, "standard", "Netbook"),
  entry(800, 800, "standard", "Square display"),
  entry(768, 1024, "standard", "Tablet portrait", "tablet"),
  entry(1024, 768, "standard", "Tablet landscape"),
  entry(720, 1280, "standard", "Portrait HD"),
  entry(1280, 720, "standard", "720p kiosk"),
  entry(1920, 480, "standard", "Cinema bar"),
  entry(1600, 600, "standard", "Wide low"),
  entry(1280, 768, "standard", "WXGA"),
  entry(1000, 1000, "standard", "Large square"),
  entry(800, 1280, "standard", "Portrait split"),
  entry(1280, 800, "standard", "1280 × 800"),
  entry(1360, 768, "standard", "HD ready"),
  entry(1366, 768, "standard", "Laptop HD"),
  entry(720, 1560, "standard", "Tall portrait"),
  entry(1080, 1080, "standard", "1080 square"),
  entry(1440, 810, "standard", "Wide 16:9"),
  entry(1280, 960, "standard", "SXGA"),
  entry(1440, 900, "standard", "WXGA+"),
  entry(1280, 1024, "standard", "SXGA panel"),
  entry(1536, 864, "standard", "Laptop"),
  entry(720, 1920, "standard", "Full HD portrait"),
  entry(1600, 900, "standard", "HD+"),
  entry(1400, 1050, "standard", "SXGA+"),
  entry(1512, 982, "standard", "MacBook 14"),
  entry(1680, 1050, "standard", "WSXGA+"),
  entry(2560, 720, "standard", "Ultra-wide bar"),
  entry(3840, 480, "standard", "Ultra bar"),
  entry(1600, 1200, "standard", "UXGA"),
  entry(1728, 1117, "standard", "MacBook 16"),
  entry(1080, 1920, "standard", "FHD portrait"),
  entry(1920, 1080, "standard", "Full HD"),
  entry(1920, 1200, "standard", "WUXGA"),
  entry(3840, 600, "standard", "Ultra-wide low"),
  entry(2160, 1080, "standard", "18:9 wide"),
  entry(2560, 1080, "standard", "Ultra-wide FHD"),
  entry(1440, 2560, "standard", "QHD portrait"),
  entry(2560, 1440, "standard", "QHD"),
  entry(2560, 1600, "standard", "WQXGA"),
  entry(3440, 1440, "standard", "Ultra-wide QHD"),
  entry(3840, 2160, "standard", "4K UHD"),
  entry(5120, 2880, "standard", "5K"),
  entry(7680, 4320, "standard", "8K UHD")
];

export type DisplayOrientation = "landscape" | "portrait";

export function viewportForMatrixEntry(
  matrixEntry: DisplayMatrixEntry,
  orientation: DisplayOrientation
): { widthPx: number; heightPx: number } {
  const { widthPx, heightPx } = matrixEntry;
  if (widthPx === heightPx) {
    return { widthPx, heightPx };
  }
  if (orientation === "landscape") {
    return {
      widthPx: Math.max(widthPx, heightPx),
      heightPx: Math.min(widthPx, heightPx)
    };
  }
  return {
    widthPx: Math.min(widthPx, heightPx),
    heightPx: Math.max(widthPx, heightPx)
  };
}

export function formatResolution(widthPx: number, heightPx: number): string {
  return `${widthPx} × ${heightPx}`;
}

export function sizeClassLabel(sizeClass: DisplaySizeClass): string {
  switch (sizeClass) {
    case "wearable":
      return "Compact";
    case "small":
      return "Small";
    case "standard":
      return "Standard";
  }
}

export const DISPLAY_MATRIX_GROUPS: readonly {
  readonly title: string;
  readonly deviceKind: ResolvedDeviceKind;
  readonly sizeClass?: DisplaySizeClass;
}[] = [
  { title: "Compact panels", deviceKind: "panel", sizeClass: "wearable" },
  { title: "Small panels", deviceKind: "panel", sizeClass: "small" },
  { title: "Standard panels", deviceKind: "panel", sizeClass: "standard" },
  { title: "Mobile", deviceKind: "mobile" },
  { title: "Tablet", deviceKind: "tablet" }
];
