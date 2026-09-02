# Display resolution catalogue

Single source for **display targets**. Two complementary matrices — not interchangeable.

| Matrix | Count | What it captures |
|--------|------:|------------------|
| **A. Preset catalogue** | **~192** parseable presets | Physical panel + native/rotated timing + effective W×H — **primary UI profile key** |
| **B. Effective W×H grid** | **67** unique sizes | Aspect/layout patterns + standard desktop/projector sizes — **supplementary layout grid** |

**Why both:** `800×480` appears in **57 presets** from **4″ to 8″** diagonals. Same pixels ≠ same look to the eye. A 2.8″ 480×272 panel and a 100″ projector at 1080p need different UI scale even when layout family matches.

Preset id (e.g. `waveshare-4.3-hdmi`, `generic-1080p`) = what the device reports.  
Effective W×H = derived for layout rules (pivot, bar, oblong).  
Physical diagonal = from preset name today; explicit field desirable in JSON later.

Non-parseable presets (no fixed profile): `auto`, `custom-hdmi`, `custom-dsi`, `custom-dpi`, `vga666` — operator sets physical size in browser designer.

| Metric | Count |
|--------|------:|
| Total presets in JSON | 197 |
| Parseable preset profiles | ~192 |
| Unique effective W×H (from JSON) | 30 |
| W×H grid incl. standard additions (§A) | 67 |
| Presets sharing same W×H (different hardware) | 181 |

---

## A. Master test matrix (67 targets)

Sorted by pixel area (smallest first). **Source:** `json` = display catalogue; `std` = standard/known addition.

| # | W×H | Aspect | Source | Size class | Device kind | Notes |
|---|-----|--------|--------|------------|-------------|-------|
| 1 | 320×240 | 1.33:1 | std | **compact** | panel | QVGA |
| 2 | 480×272 | 1.76:1 | json | **compact** | panel | strip |
| 3 | 480×320 | 1.50:1 | json | **compact** | panel | strip |
| 4 | 360×640 | 0.56:1 | std | small | **mobile** | phone portrait |
| 5 | 480×480 | 1.00:1 | json | **compact** | panel | stack / round |
| 6 | 640×360 | 1.78:1 | std | **compact** | panel | strip / nHD |
| 7 | 375×667 | 0.56:1 | std | small | **mobile** | iPhone SE class |
| 8 | 480×640 | 0.75:1 | json | small | panel | stack |
| 9 | 640×480 | 1.33:1 | json | small | panel | stack |
| 10 | 390×844 | 0.46:1 | std | small | **mobile** | iPhone 14 class |
| 11 | 600×600 | 1.00:1 | std | small | panel | square |
| 12 | 414×896 | 0.46:1 | std | small | **mobile** | iPhone 11 class |
| 13 | 480×800 | 0.60:1 | json | small | panel | stack |
| 14 | 800×480 | 1.67:1 | json | standard | panel | split (largest JSON cluster) |
| 15 | 480×854 | 0.56:1 | std | small | **mobile** | Android portrait |
| 16 | 854×480 | 1.78:1 | std | standard | panel | FWVGA |
| 17 | 1480×320 | 4.63:1 | json | standard | bar |
| 18 | 800×600 | 1.33:1 | std | standard | SVGA |
| 19 | 1280×400 | 3.20:1 | json | standard | bar |
| 20 | 540×960 | 0.56:1 | std | small | **mobile** | qHD portrait |
| 21 | 720×720 | 1.00:1 | json | standard | stack / square kiosk |
| 22 | 960×540 | 1.78:1 | std | standard | qHD |
| 23 | 960×544 | 1.76:1 | json | standard | split |
| 24 | 1420×380 | 3.74:1 | std | standard | Evo dev bar (not in JSON) |
| 25 | 1024×600 | 1.71:1 | json | standard | split |
| 26 | 800×800 | 1.00:1 | json | standard | split / square |
| 27 | 768×1024 | 0.75:1 | std | standard | **tablet** | iPad portrait |
| 28 | 1024×768 | 1.33:1 | json | standard | split |
| 29 | 720×1280 | 0.56:1 | json | standard | stack portrait |
| 30 | 1280×720 | 1.78:1 | json | standard | full / 720p |
| 31 | 1920×480 | 4.00:1 | json | standard | bar |
| 32 | 1600×600 | 2.67:1 | json | standard | full / wide-low |
| 33 | 1280×768 | 1.67:1 | std | standard | WXGA |
| 34 | 1000×1000 | 1.00:1 | std | standard | square |
| 35 | 800×1280 | 0.63:1 | json | standard | split portrait |
| 36 | 1280×800 | 1.60:1 | json | standard | full |
| 37 | 1360×768 | 1.77:1 | std | standard | WXGA variant |
| 38 | 1366×768 | 1.78:1 | json | standard | full / HD ready |
| 39 | 720×1560 | 0.46:1 | json | standard | stack portrait |
| 40 | 1080×1080 | 1.00:1 | json | standard | square |
| 41 | 1440×810 | 1.78:1 | std | standard | 16:9 variant |
| 42 | 1280×960 | 1.33:1 | std | standard | SXGA− |
| 43 | 1440×900 | 1.60:1 | std | standard | WXGA+ |
| 44 | 1280×1024 | 1.25:1 | std | standard | SXGA |
| 45 | 1536×864 | 1.78:1 | std | standard | common laptop |
| 46 | 720×1920 | 0.38:1 | json | standard | stack portrait |
| 47 | 1600×900 | 1.78:1 | std | standard | HD+ |
| 48 | 1400×1050 | 1.33:1 | std | standard | SXGA+ |
| 49 | 1512×982 | 1.54:1 | std | standard | MacBook 14 class |
| 50 | 1680×1050 | 1.60:1 | std | standard | WSXGA+ |
| 51 | 2560×720 | 3.56:1 | std | standard | ultra-wide bar |
| 52 | 3840×480 | 8.00:1 | std | standard | ultra bar |
| 53 | 1600×1200 | 1.33:1 | std | standard | UXGA |
| 54 | 1728×1117 | 1.55:1 | std | standard | MacBook 16 class |
| 55 | 1080×1920 | 0.56:1 | std | standard | FHD portrait |
| 56 | 1920×1080 | 1.78:1 | json | standard | full / 1080p |
| 57 | 1920×1200 | 1.60:1 | json | standard | full / WUXGA |
| 58 | 3840×600 | 6.40:1 | std | standard | ultra bar |
| 59 | 2160×1080 | 2.00:1 | json | standard | full / 18:9 |
| 60 | 2560×1080 | 2.37:1 | std | standard | ultra-wide FHD |
| 61 | 1440×2560 | 0.56:1 | std | standard | QHD portrait |
| 62 | 2560×1440 | 1.78:1 | json | standard | cinema / QHD |
| 63 | 2560×1600 | 1.60:1 | json | standard | cinema |
| 64 | 3440×1440 | 2.39:1 | std | standard | ultra-wide QHD |
| 65 | 3840×2160 | 1.78:1 | json | standard | cinema / 4K UHD |
| 66 | 5120×2880 | 1.78:1 | std | standard | 5K |
| 67 | 7680×4320 | 1.78:1 | std | standard | 8K UHD |

### Copy-paste list (67)

```
320x240, 480x272, 480x320, 360x640, 480x480, 640x360, 375x667, 480x640, 640x480, 390x844, 600x600, 414x896, 480x800, 800x480, 480x854, 854x480, 1480x320, 800x600, 1280x400, 540x960, 720x720, 960x540, 960x544, 1420x380, 1024x600, 800x800, 768x1024, 1024x768, 720x1280, 1280x720, 1920x480, 1600x600, 1280x768, 1000x1000, 800x1280, 1280x800, 1360x768, 1366x768, 720x1560, 1080x1080, 1440x810, 1280x960, 1440x900, 1280x1024, 1536x864, 720x1920, 1600x900, 1400x1050, 1512x982, 1680x1050, 2560x720, 3840x480, 1600x1200, 1728x1117, 1080x1920, 1920x1080, 1920x1200, 3840x600, 2160x1080, 2560x1080, 1440x2560, 2560x1440, 2560x1600, 3440x1440, 3840x2160, 5120x2880, 7680x4320
```

Remaining rows (17–26, 28–67): **device kind = panel** unless noted in §H.

---

## B. From display JSON only (30)

| W×H | Presets | Layout hint |
|-----|--------:|-------------|
| 480×272 | 1 | strip |
| 480×320 | 5 | strip |
| 480×480 | 1 | stack |
| 480×640 | 1 | stack |
| 640×480 | 5 | stack |
| 480×800 | 2 | stack |
| 800×480 | 57 | split |
| 960×544 | 1 | split |
| 1024×600 | 39 | split |
| 800×800 | 2 | split |
| 1024×768 | 1 | split |
| 720×720 | 6 | stack / square |
| 720×1280 | 11 | stack |
| 1280×400 | 2 | bar |
| 1280×720 | 4 | full |
| 1280×800 | 18 | full |
| 1366×768 | 3 | full |
| 1480×320 | 2 | bar |
| 1600×600 | 1 | full |
| 800×1280 | 4 | split |
| 720×1560 | 1 | stack |
| 1080×1080 | 2 | square |
| 720×1920 | 1 | stack |
| 1920×480 | 4 | bar |
| 1920×1080 | 10 | full |
| 1920×1200 | 3 | full |
| 2160×1080 | 1 | full |
| 2560×1440 | 1 | cinema |
| 2560×1600 | 1 | cinema |
| 3840×2160 | 2 | cinema |

Layout hints are catalogue labels only — not test shortcuts. Each W×H is still tested on its own.

---

## C. Standard additions only (37)

Not present in `display_presets.json` but included for completeness (dev, desktop, mobile, ultra-wide).

320×240 · 360×640 · 375×667 · 390×844 · 414×896 · 480×854 · 540×960 · 600×600 · 640×360 · 768×1024 · 800×600 · 854×480 · 960×540 · 1000×1000 · 1080×1920 · 1280×768 · 1280×960 · 1280×1024 · 1360×768 · 1400×1050 · **1420×380** · 1440×810 · 1440×900 · 1440×2560 · 1512×982 · 1536×864 · 1600×900 · 1600×1200 · 1680×1050 · 1728×1117 · 2560×720 · 2560×1080 · 3440×1440 · 3840×480 · 3840×600 · 5120×2880 · 7680×4320

---

## F. Size class definitions

**Label note:** “wearable” in code = **compact** in docs and designer (small viewport — not wrist-worn product category).

Three **panel density** classes sit on top of fold tiers (`docs/RESPONSIVE_FOLD_MODEL.md`). Size class decides **panel nav chrome** when `deviceKind=panel`. Orthogonal to **device kind** (§H).

| Class | UI label | Count | Rule (effective W×H) | Layout profiles |
|-------|----------|------:|------------------------|-----------------|
| **wearable** | Compact | 5 | `min(w,h) ≤ 360` **OR** `(h ≤ 320 AND w ≤ 640)` **OR** `(w ≤ 480 AND h ≤ 480)` | solo, strip |
| **small** | Small | 10 | not compact **and** `w < 800` | stack |
| **standard** | Standard | 52 | `w ≥ 800` | split, full, bar, cinema |

### Compact panel targets (5)

320×240 · 480×272 · 480×320 · 480×480 · 640×360

### Small panel targets (7 — excludes mobile reference rows)

480×640 · 640×480 · 600×600 · 480×800 · *(borderline: 720×720 — see tests)*

Mobile reference rows (360×640 … 540×960) share `sizeClass=small` for density but **`deviceKind=mobile`** — pivot does not apply (§H).

### Decision function (for `presentation-target.ts`)

```ts
export type SizeClass = "wearable" | "small" | "standard";

export function sizeClass(w: number, h: number): SizeClass {
  const mn = Math.min(w, h);
  if (mn <= 360) return "wearable";
  if (h <= 320 && w <= 640) return "wearable";
  if (w <= 480 && h <= 480) return "wearable";
  return w < 800 ? "small" : "standard";
}
```

Set on root alongside fold tier and device kind:

```html
<html
  data-fold-tier="strip"
  data-size-class="wearable"
  data-device-kind="panel"
  data-device-kind-setting="auto"
  data-interaction="pivot"
/>
```

**Borderline resolutions** (640×480, 600×600, 720×720): class assignment is provisional — test each separately and reclassify from evidence.

---

## H. Primary screen kind (`deviceKind`)

**Four settings:** `auto` (default) · `panel` · `mobile` · `tablet`  
**Three resolved kinds:** `panel` · `mobile` · `tablet`

Same effective W×H can differ by kind — e.g. **720×1280** on a Pi DSI preset = **panel**; **390×844** in a phone browser = **mobile**.

### Resolution order (`auto`)

1. Profile `ui.profile.byPreset[id].deviceKind` or `ui.profile.custom.deviceKind` when not `auto`
2. Designer / explicit runtime setting (preview)
3. Matrix row tag when previewing a catalogue size in designer
4. Viewport heuristics (mobile / tablet reference ids)
5. Fallback **`panel`**

### Reference rows by kind

| Kind | Portrait-native ids | Test orientations |
|------|---------------------|-------------------|
| **mobile** | 360×640 · 375×667 · 390×844 · 414×896 · 480×854 · 540×960 | portrait **and** landscape |
| **tablet** | 768×1024 | portrait **and** landscape |
| **panel** | all other §A rows + all JSON presets | per product |

### Interaction by kind

| Resolved kind | `data-interaction` | Nav model |
|---------------|-------------------|-----------|
| **panel** compact/small | `pivot` | ● compass + sheets (`SMALL_SCREEN_PIVOT.md`) |
| **panel** standard | `standard` | Oblong + rails |
| **mobile** | `standard` | Scroll-native companion (chrome TBD) |
| **tablet** | `standard` | Scroll + split where width allows (chrome TBD) |

### Designer

**Primary screen** control: Auto / Panel / Mobile / Tablet — filters the size list and sets preview `data-device-kind`.

**Apply to device** writes `ui.profile.custom` (designer preview) or `ui.profile.byPreset[id]` when a catalogue preset is selected:

```json
{
  "ui.profile": {
    "custom": {
      "widthPx": 390,
      "heightPx": 844,
      "deviceKind": "mobile"
    }
  }
}
```

On boot, the shell reads `ui.profile` + optional `ui.display.preset_id` and applies before first paint (via `PresentationProvider`).

### Profile shape

```ts
interface PresetProfile {
  displayFactor?: number;
  deviceKind?: "auto" | "panel" | "mobile" | "tablet";
  smallLanding?: "compass" | "track"; // panel compact only
}
```

---

## G. Small-screen interaction (pivot model)

Full spec: **`SMALL_SCREEN_PIVOT.md`**

Small **panel** compact/small classes use the **player pivot** — not sidebar, not bottom nav. **Mobile and tablet kinds never use pivot** (§H).

| Swipe from ● | Reveals |
|--------------|---------|
| ← | Artwork (full bleed) |
| → | Bio scroll |
| ↓ | Library tiles (Queue, Browse, Playlists, Favourites, …) |
| ↑ | Device tiles (Settings, Network, Power, …) |

**Tier 0 landing invariants:** transport, title, artist, ●, connection dot, volume icon.  
**Never Tier 0:** visualiser, bio, queue, plugin settings, spectrum, engineer tools.

Plugins register **tiles into planes** (`listen | connect | storage | automate | system`) — they cannot add landing chrome.

When `data-device-kind="panel"` and `data-size-class` is `wearable` or `small`, the shell **does not** use the desktop sidebar, the 760px slide-out drawer, or the four-icon bottom strip.

### G.1 Size-class summary

| Class | Rest | Nav |
|-------|------|-----|
| wearable (5) | strip / mini stack + ● | pivot sheets, max 4 tiles visible |
| small (10) | control stack + ● | full pivot |
| standard (52) | oblong row + rails | rails primary; pivot optional |

Verify pivot independently on all **15 wearable + small targets** (§D) before assuming patterns transfer to standard.

---

## D. Test status (per resolution)

Fill in as each viewport is verified. Patterns emerge from this table — do not skip rows.

| W×H | Source | Size class | Status | Issues |
|-----|--------|------------|--------|--------|
| 320×240 | std | wearable | — | |
| 480×272 | json | wearable | — | |
| 480×320 | json | wearable | — | |
| 360×640 | std | small | — | |
| 480×480 | json | wearable | — | |
| 640×360 | std | wearable | — | |
| 375×667 | std | small | — | |
| 480×640 | json | small | — | |
| 640×480 | json | small | — | |
| 390×844 | std | small | — | |
| 600×600 | std | small | — | |
| 414×896 | std | small | — | |
| 480×800 | json | small | — | |
| 800×480 | json | standard | — | |
| 480×854 | std | small | — | |
| 854×480 | std | standard | — | |
| 1480×320 | json | standard | — | |
| 800×600 | std | standard | — | |
| 1280×400 | json | standard | — | |
| 540×960 | std | small | — | |
| 720×720 | json | standard | — | |
| 960×540 | std | standard | — | |
| 960×544 | json | standard | — | |
| 1420×380 | std | standard | — | |
| 1024×600 | json | standard | — | |
| 800×800 | json | standard | — | |
| 768×1024 | std | standard | — | |
| 1024×768 | json | standard | — | |
| 720×1280 | json | standard | — | |
| 1280×720 | json | standard | — | |
| 1920×480 | json | standard | — | |
| 1600×600 | json | standard | — | |
| 1280×768 | std | standard | — | |
| 1000×1000 | std | standard | — | |
| 800×1280 | json | standard | — | |
| 1280×800 | json | standard | — | |
| 1360×768 | std | standard | — | |
| 1366×768 | json | standard | — | |
| 720×1560 | json | standard | — | |
| 1080×1080 | json | standard | — | |
| 1440×810 | std | standard | — | |
| 1280×960 | std | standard | — | |
| 1440×900 | std | standard | — | |
| 1280×1024 | std | standard | — | |
| 1536×864 | std | standard | — | |
| 720×1920 | json | standard | — | |
| 1600×900 | std | standard | — | |
| 1400×1050 | std | standard | — | |
| 1512×982 | std | standard | — | |
| 1680×1050 | std | standard | — | |
| 2560×720 | std | standard | — | |
| 3840×480 | std | standard | — | |
| 1600×1200 | std | standard | — | |
| 1728×1117 | std | standard | — | |
| 1080×1920 | std | standard | — | |
| 1920×1080 | json | standard | — | |
| 1920×1200 | json | standard | — | |
| 3840×600 | std | standard | — | |
| 2160×1080 | json | standard | — | |
| 2560×1080 | std | standard | — | |
| 1440×2560 | std | standard | — | |
| 2560×1440 | json | standard | — | |
| 2560×1600 | json | standard | — | |
| 3440×1440 | std | standard | — | |
| 3840×2160 | json | standard | — | |
| 5120×2880 | std | standard | — | |
| 7680×4320 | std | standard | — | |

---

## E. Device preset appendix (197 rows)

Maps hardware preset ID → effective UI resolution. Use when a device reports a preset name; test target is always the **effective W×H** from section A.

| ID | Name | Type | Native | Effective | Rot |
|----|------|------|--------|-----------|----:|
| `auto` | Auto Detect (EDID) | hdmi | — | **—** | 0° |
| `custom-dpi` | Custom/Generic DPI Panel | dpi | custom | **—** | 0° |
| `custom-dsi` | Custom/Generic DSI Panel | dsi | custom | **—** | 0° |
| `custom-hdmi` | Custom HDMI Timings | hdmi | — | **—** | 0° |
| `vga666` | VGA666 Adapter | dpi | various | **—** | 0° |
| `waveshare-4.3-hdmi` | Waveshare 4.3" HDMI LCD (480x272) | hdmi | 480x272 | **480x272** | 0° |
| `generic-480x320` | Generic 480x320 HDMI | hdmi | 480x320 | **480x320** | 0° |
| `lcdwiki-3.5-hdmi` | LCDwiki 3.5" HDMI (480x320) | hdmi | 480x320 | **480x320** | 0° |
| `owootecc-dpi-4.3` | Owootecc 4.3" DPI Panel (480x320) | dpi | 480x320 | **480x320** | 0° |
| `uctronics-3.5-hdmi` | UCTRONICS 3.5" HDMI (480x320) | hdmi | 480x320 | **480x320** | 0° |
| `waveshare-3.5-hdmi` | Waveshare 3.5" HDMI LCD (480x320) | hdmi | 480x320 | **480x320** | 0° |
| `hyperpixel2r` | Pimoroni HyperPixel 2.1 Round | dpi | 480x480 | **480x480** | 0° |
| `waveshare-dsi-2.8` | Waveshare 2.8" DSI (480x640) | dsi | 480x640 | **480x640** | 0° |
| `waveshare-dsi-3.5h` | Waveshare 3.5" DSI-H (480x800) | dsi | 480x800 | **480x800** | 0° |
| `waveshare-dsi-4.0` | Waveshare 4.0" DSI (480x800) | dsi | 480x800 | **480x800** | 0° |
| `waveshare-2.8-hdmi-h` | Waveshare 2.8" HDMI LCD (H) (480x640) | hdmi | 480x640 | **640x480** | 90° |
| `waveshare-2.8dpi` | Waveshare 2.8" DPI LCD (480x640) | dpi | 480x640 | **640x480** | 90° |
| `waveshare-3.5-hdmi-e` | Waveshare 3.5" HDMI LCD (E) (640x480) | hdmi | 640x480 | **640x480** | 0° |
| `waveshare-3.5dpi` | Waveshare 3.5" DPI LCD (640x480) | dpi | 640x480 | **640x480** | 0° |
| `waveshare-dsi-3.5e` | Waveshare 3.5" DSI-E (640x480) | dsi | 640x480 | **640x480** | 0° |
| `hyperpixel4sq` | Pimoroni HyperPixel 4.0 Square | dpi | 720x720 | **720x720** | 0° |
| `waveshare-4-720x720-hdmi` | Waveshare 4" Square HDMI (720x720) | hdmi | 720x720 | **720x720** | 0° |
| `waveshare-4-hdmi-c` | Waveshare 4" HDMI LCD (C) (720x720) | hdmi | 720x720 | **720x720** | 0° |
| `waveshare-4dpi-c` | Waveshare 4" DPI LCD-C (720x720) | dpi | 720x720 | **720x720** | 0° |
| `waveshare-dsi-4.0c` | Waveshare 4.0" DSI-C (720x720) | dsi | 720x720 | **720x720** | 0° |
| `waveshare-dsi-v2-4.0c` | Waveshare 4.0" DSI-TOUCH V2 (720x720) | dsi | 720x720 | **720x720** | 0° |
| `rpi-touch2-5inch` | Raspberry Pi Touch Display 2 - 5" | dsi | 720x1280 | **720x1280** | 0° |
| `rpi-touch2-7inch` | Raspberry Pi Touch Display 2 - 7" | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-5.0` | Waveshare 5.0" DSI (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-10.1b` | Waveshare 10.1" DSI-TOUCH V2-B 2-lane (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-10.1b-4lane` | Waveshare 10.1" DSI-TOUCH V2-B 4-lane (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-5.0a` | Waveshare 5.0" DSI-TOUCH V2-A (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-5.5a` | Waveshare 5.5" DSI-TOUCH V2-A (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-7.0a` | Waveshare 7.0" DSI-TOUCH V2-A (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-7.0b` | Waveshare 7.0" DSI-TOUCH V2-B (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-9.0b` | Waveshare 9.0" DSI-TOUCH V2-B 2-lane (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-v2-9.0b-4lane` | Waveshare 9.0" DSI-TOUCH V2-B 4-lane (720x1280) | dsi | 720x1280 | **720x1280** | 0° |
| `waveshare-dsi-6.25` | Waveshare 6.25" DSI (720x1560) | dsi | 720x1560 | **720x1560** | 0° |
| `waveshare-dsi-v2-12.3a-4lane` | Waveshare 12.3" DSI-TOUCH V2-A 4-lane (720x1920) | dsi | 720x1920 | **720x1920** | 0° |
| `adafruit-5-800x480` | Adafruit 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `adafruit-5-backpack` | Adafruit 5" Display Backpack (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `adafruit-7-800x480` | Adafruit 7" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `btt-hdmi5-v1.0` | BIGTREETECH HDMI5 V1.0 (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `btt-pitft43-v2.0` | BIGTREETECH PI TFT43 V2.0 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft43-v2.1` | BIGTREETECH PI TFT43 V2.1 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft50-v1.0` | BIGTREETECH PI TFT50 V1.0 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft50-v2.0` | BIGTREETECH PI TFT50 V2.0 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft50-v2.1` | BIGTREETECH PI TFT50 V2.1 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft70-v2.0` | BIGTREETECH PI TFT70 V2.0 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-pitft70-v2.1` | BIGTREETECH PI TFT70 V2.1 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `btt-tft43-dip` | BIGTREETECH TFT43-DIP (800x480) | dpi | 800x480 | **800x480** | 0° |
| `dfrobot-dsi-5-tft-v1.0` | DFRobot 5" TFT with Touchscreen V1.0 (800x480) | dsi | 800x480 | **800x480** | 0° |
| `elecrow-5-hdmi` | Elecrow 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `freenove-4.3-dsi` | Freenove 4.3" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `freenove-5-dsi` | Freenove 5" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `freenove-7-dsi` | Freenove 7" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `geeekpi-5-hdmi` | GeeekPi/52Pi 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `generic-800x480` | Generic 800x480 HDMI | hdmi | 800x480 | **800x480** | 0° |
| `hmtech-7-hdmi` | HMTECH 7" HDMI Monitor (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `hosyond-5-dsi` | Hosyond 5" DSI Display (800x480) | dsi | 800x480 | **800x480** | 0° |
| `hosyond-5-hdmi-b` | Hosyond 5" HDMI Display-B (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `hosyond-7-dsi` | Hosyond 7" DSI Display (800x480) | dsi | 800x480 | **800x480** | 0° |
| `hyperpixel4` | Pimoroni HyperPixel 4.0 | dpi | 800x480 | **800x480** | 0° |
| `joyit-5-hdmi-v2` | Joy-IT 5" HDMI LCD V2 (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `kuman-7-800x480` | Kuman 7" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `lcdwiki-4-hdmi-c` | LCDwiki 4" HDMI-C (480x800) | hdmi | 480x800 | **800x480** | 90° |
| `lcdwiki-5-hdmi` | LCDwiki 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `lcdwiki-7-hdmi-b` | LCDwiki 7" HDMI-B (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `longruner-5-hdmi` | Longruner 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `pollin-5-hdmi-800x480` | Pollin 5" HDMI 800x480 Touch (pre-2020) | hdmi | 800x480 | **800x480** | 0° |
| `rpi-touch-7inch` | Raspberry Pi Touch Display 7" (Original) | dsi | 800x480 | **800x480** | 0° |
| `spotpear-4-hdmi` | Spotpear 4" HDMI (480x800) | hdmi | 480x800 | **800x480** | 90° |
| `uctronics-5-hdmi` | UCTRONICS 5" HDMI (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-4-hdmi` | Waveshare 4" HDMI LCD (480x800) | hdmi | 480x800 | **800x480** | 90° |
| `waveshare-4-hdmi-h` | Waveshare 4" HDMI LCD (H) (480x800) | hdmi | 480x800 | **800x480** | 90° |
| `waveshare-4.3-hdmi-b` | Waveshare 4.3" HDMI LCD (B) (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-4dpi-b` | Waveshare 4" DPI LCD (B) (480x800) | dpi | 480x800 | **800x480** | 90° |
| `waveshare-5-hdmi` | Waveshare 5" HDMI LCD (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-5-hdmi-b` | Waveshare 5" HDMI LCD (B) (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-5-hdmi-g` | Waveshare 5" HDMI LCD (G) (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-5-hdmi-h` | Waveshare 5" HDMI LCD (H) (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-5-hdmi-h-v4` | Waveshare 5" HDMI LCD (H) V4 (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-5dpi` | Waveshare 5" DPI LCD (800x480) | dpi | 800x480 | **800x480** | 0° |
| `waveshare-7-hdmi-b` | Waveshare 7" HDMI LCD (B) (800x480) | hdmi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-4.3-800x480` | Waveshare 4.3" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-4.3-qled` | Waveshare 4.3" DSI QLED (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-4.3-rev1-knockout` | Waveshare 4.3" DSI rev1 (TC358762 / no vc4-kms-v3d) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-5.0-800x480` | Waveshare 5" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-5.0b-800x480` | Waveshare 5" DSI-B IPS (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-5.0c-800x480` | Waveshare 5" DSI-C IPS (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-5.0d-800x480` | Waveshare 5" DSI-D IPS (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-7.0-800x480` | Waveshare 7" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-7.0-with-cam` | Waveshare 7" DSI with Camera (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-7.0b-800x480` | Waveshare 7" DSI-B (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-8.0-800x480` | Waveshare 8" DSI (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-8.0-with-cam` | Waveshare 8" DSI with Camera (800x480) | dsi | 800x480 | **800x480** | 0° |
| `waveshare-dsi-3.4-round` | Waveshare 3.4" DSI Round (800x800) | dsi | 800x800 | **800x800** | 0° |
| `waveshare-dsi-v2-3.4c` | Waveshare 3.4" DSI-TOUCH V2 (800x800) | dsi | 800x800 | **800x800** | 0° |
| `waveshare-dsi-v2-10.1a` | Waveshare 10.1" DSI-TOUCH V2-A 2-lane (800x1280) | dsi | 800x1280 | **800x1280** | 0° |
| `waveshare-dsi-v2-10.1a-4lane` | Waveshare 10.1" DSI-TOUCH V2-A 4-lane (800x1280) | dsi | 800x1280 | **800x1280** | 0° |
| `waveshare-dsi-v2-8.0a` | Waveshare 8.0" DSI-TOUCH V2-A 2-lane (800x1280) | dsi | 800x1280 | **800x1280** | 0° |
| `waveshare-dsi-v2-8.0a-4lane` | Waveshare 8.0" DSI-TOUCH V2-A 4-lane (800x1280) | dsi | 800x1280 | **800x1280** | 0° |
| `waveshare-5-hdmi-amoled` | Waveshare 5" HDMI AMOLED (960x544) | hdmi | 960x544 | **960x544** | 0° |
| `adafruit-7-1024x600` | Adafruit 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `btt-hdmi7-v1.0` | BIGTREETECH HDMI7 V1.0 (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `btt-hdmi7-v1.2` | BIGTREETECH HDMI7 V1.2 (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `elecrow-7-hdmi` | Elecrow 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `freenove-7-hdmi` | Freenove 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `geeekpi-10.1-hdmi-1024` | GeeekPi/52Pi 10.1" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `geeekpi-7-hdmi` | GeeekPi/52Pi 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `generic-1024x600` | Generic 1024x600 HDMI | hdmi | 1024x600 | **1024x600** | 0° |
| `hmtech-10.1-hdmi` | HMTECH 10.1" HDMI Touchscreen (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `hosyond-10.1-hdmi-h` | Hosyond 10.1" HDMI Display-H (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `hosyond-10.1-hdmi-s` | Hosyond 10.1" HDMI Display-S (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `hosyond-10.1-hdmi-y` | Hosyond 10.1" HDMI Display-Y (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `hosyond-7-hdmi-c` | Hosyond 7" HDMI Display-C (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `hosyond-7-hdmi-h` | Hosyond 7" HDMI Display-H (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `joyit-7-hdmi-v2` | Joy-IT 7" HDMI LCD V2 (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `kuman-7-1024x600` | Kuman 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `lcdwiki-7-hdmi-c` | LCDwiki 7" HDMI-C (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `longruner-7-hdmi` | Longruner 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `seeed-7-1024x600` | Seeed Studio 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `spotpear-10.1-hdmi` | Spotpear 10.1" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `spotpear-5-hdmi` | Spotpear 5" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `spotpear-7-hdmi` | Spotpear 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `sunfounder-10.1-1024x600` | Sunfounder 10.1" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `sunfounder-7-1024x600` | Sunfounder 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `uctronics-7-hdmi` | UCTRONICS 7" HDMI (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi` | Waveshare 10.1" HDMI LCD (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-d-case` | Waveshare 10.1" HDMI LCD (D) with Case (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-e` | Waveshare 10.1" HDMI LCD (E) (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-f` | Waveshare 10.1" HDMI LCD (F) (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-g-case` | Waveshare 10.1" HDMI LCD (G) with Case (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-h` | Waveshare 10.1" HDMI LCD (H) (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-10.1-hdmi-h-case` | Waveshare 10.1" HDMI LCD (H) with Case (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-7-hdmi` | Waveshare 7" HDMI LCD (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-7-hdmi-c` | Waveshare 7" HDMI LCD (C) (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-7-hdmi-h` | Waveshare 7" HDMI LCD (H) (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-7-hdmi-h-case` | Waveshare 7" HDMI LCD (H) with Case (1024x600) | hdmi | 1024x600 | **1024x600** | 0° |
| `waveshare-7dpi` | Waveshare 7" DPI LCD (1024x600) | dpi | 1024x600 | **1024x600** | 0° |
| `waveshare-dsi-7.0c` | Waveshare 7.0" DSI-C (1024x600) | dsi | 1024x600 | **1024x600** | 0° |
| `waveshare-dsi-v2-7.0c` | Waveshare 7.0" DSI-TOUCH V2-C (1024x600) | dsi | 1024x600 | **1024x600** | 0° |
| `uctronics-7-1024x768` | UCTRONICS 7" HDMI (1024x768) | hdmi | 1024x768 | **1024x768** | 0° |
| `spotpear-5-round-hdmi` | Spotpear 5" Round HDMI (1080x1080) | hdmi | 1080x1080 | **1080x1080** | 0° |
| `waveshare-5-1080x1080-hdmi` | Waveshare 5" Round HDMI (1080x1080) | hdmi | 1080x1080 | **1080x1080** | 0° |
| `waveshare-7.9-hdmi` | Waveshare 7.9" HDMI LCD (400x1280) | hdmi | 400x1280 | **1280x400** | 90° |
| `waveshare-dsi-7.9` | Waveshare 7.9" DSI (400x1280) | dsi | 400x1280 | **1280x400** | 90° |
| `generic-720p` | 720p (1280x720) | hdmi | 1280x720 | **1280x720** | 0° |
| `seeed-5-720x1280` | Seeed Studio 5" HDMI (720x1280) | hdmi | 720x1280 | **1280x720** | 90° |
| `seeed-7-720x1280` | Seeed Studio 7" HDMI (720x1280) | hdmi | 720x1280 | **1280x720** | 90° |
| `waveshare-dsi-7.0h` | Waveshare 7.0" DSI-H (1280x720) | dsi | 1280x720 | **1280x720** | 0° |
| `adafruit-10.1-1280x800` | Adafruit 10.1" HDMI IPS (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `adafruit-7-1280x800` | Adafruit 7" HDMI IPS (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `geeekpi-10.1-hdmi-1280` | GeeekPi/52Pi 10.1" HDMI (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `geeekpi-7-hdmi-1280` | GeeekPi/52Pi 7" HDMI (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `generic-1280x800` | Generic 1280x800 HDMI | hdmi | 1280x800 | **1280x800** | 0° |
| `joyit-10-hdmi-v2` | Joy-IT 10" HDMI LCD V2 (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `joyit-10.1-hdmi-b` | Joy-IT 10.1" HDMI LCD Version B (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `joyit-10.1-hdmi-v3` | Joy-IT 10.1" IPS HDMI V3 (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `seeed-10.1-1280x800` | Seeed Studio 10.1" HDMI IPS (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `seeed-7-1280x800` | Seeed Studio 7" HDMI IPS (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `spotpear-7-hdmi-1280` | Spotpear 7" HDMI (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `waveshare-10.1-hdmi-b` | Waveshare 10.1" HDMI LCD (B) (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `waveshare-10.1-hdmi-b-case` | Waveshare 10.1" HDMI LCD (B) with Case (1280x800) | hdmi | 1280x800 | **1280x800** | 0° |
| `waveshare-dsi-10.1` | Waveshare 10.1" DSI (1280x800) | dsi | 1280x800 | **1280x800** | 0° |
| `waveshare-dsi-10.1c` | Waveshare 10.1" DSI-C (1280x800) | dsi | 1280x800 | **1280x800** | 0° |
| `waveshare-dsi-7.0e` | Waveshare 7.0" DSI-E (1280x800) | dsi | 1280x800 | **1280x800** | 0° |
| `waveshare-dsi-8.0` | Waveshare 8.0" DSI (1280x800) | dsi | 1280x800 | **1280x800** | 0° |
| `waveshare-dsi-8.0c` | Waveshare 8.0" DSI-C (1280x800) | dsi | 1280x800 | **1280x800** | 0° |
| `geeekpi-11.6-hdmi` | GeeekPi/52Pi 11.6" HDMI (1366x768) | hdmi | 1366x768 | **1366x768** | 0° |
| `generic-1366x768` | Generic 1366x768 HDMI (HD Ready) | hdmi | 1366x768 | **1366x768** | 0° |
| `seeed-10.1-1366x768` | Seeed Studio 10.1" HDMI (1366x768) | hdmi | 1366x768 | **1366x768** | 0° |
| `waveshare-11.9-hdmi` | Waveshare 11.9" HDMI LCD (320x1480) | hdmi | 320x1480 | **1480x320** | 90° |
| `waveshare-dsi-11.9` | Waveshare 11.9" DSI (320x1480) | dsi | 320x1480 | **1480x320** | 90° |
| `waveshare-9.3-hdmi` | Waveshare 9.3" HDMI LCD (1600x600) | hdmi | 1600x600 | **1600x600** | 0° |
| `hosyond-8.8-hdmi` | Hosyond 8.8" HDMI Bar (480x1920) | hdmi | 480x1920 | **1920x480** | 90° |
| `waveshare-8.8-hdmi` | Waveshare 8.8" HDMI Side Monitor (480x1920) | hdmi | 480x1920 | **1920x480** | 90° |
| `waveshare-dsi-8.8` | Waveshare 8.8" DSI (480x1920) | dsi | 480x1920 | **1920x480** | 90° |
| `waveshare-dsi-v2-8.8a` | Waveshare 8.8" DSI-TOUCH V2-A (480x1920) | dsi | 480x1920 | **1920x480** | 90° |
| `generic-1080p` | 1080p (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-11.6-hdmi-h` | Waveshare 11.6" HDMI LCD (H) (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-11.6-hdmi-h-case` | Waveshare 11.6" HDMI LCD (H) with Case (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-13.3-hdmi-h` | Waveshare 13.3" HDMI LCD (H) (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-15.6-fhd-monitor-b` | Waveshare 15.6" FHD Monitor (B) (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-15.6-hdmi` | Waveshare 15.6" HDMI LCD (1920x1080) | hdmi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-5.5-hdmi-amoled` | Waveshare 5.5" HDMI AMOLED (1080x1920) | hdmi | 1080x1920 | **1920x1080** | 90° |
| `waveshare-7-fhd-hdmi` | Waveshare 7" FHD HDMI Monitor (1080x1920) | hdmi | 1080x1920 | **1920x1080** | 90° |
| `waveshare-dsi-13.3-2lane` | Waveshare 13.3" DSI 2-lane (1920x1080) | dsi | 1920x1080 | **1920x1080** | 0° |
| `waveshare-dsi-13.3-4lane` | Waveshare 13.3" DSI 4-lane (1920x1080) | dsi | 1920x1080 | **1920x1080** | 0° |
| `jdi-lt070me05000` | JDI LT070ME05000 DSI (1920x1200) | dsi | 1920x1200 | **1920x1200** | 0° |
| `jdi-lt070me05000-v2` | JDI LT070ME05000 V2 DSI (1920x1200) | dsi | 1920x1200 | **1920x1200** | 0° |
| `seeed-10.1-1200x1920` | Seeed Studio 10.1" HDMI IPS (1200x1920) | hdmi | 1200x1920 | **1920x1200** | 90° |
| `waveshare-6-hdmi-amoled` | Waveshare 6" HDMI AMOLED (1080x2160) | hdmi | 1080x2160 | **2160x1080** | 90° |
| `waveshare-5.5-hdmi-2k` | Waveshare 5.5" 2K HDMI LCD (1440x2560) | hdmi | 1440x2560 | **2560x1440** | 90° |
| `waveshare-10.5-hdmi-amoled` | Waveshare 10.5" HDMI AMOLED (2560x1600) | hdmi | 2560x1600 | **2560x1600** | 0° |
| `generic-4k30` | 4K 30Hz (3840x2160) | hdmi | 3840x2160 | **3840x2160** | 0° |
| `generic-4k60` | 4K 60Hz (3840x2160) | hdmi | 3840x2160 | **3840x2160** | 0° |
