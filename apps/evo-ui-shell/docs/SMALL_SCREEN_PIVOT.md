# Small screen pivot architecture

Status: design draft — 2026-06-05  
Companion: `DISPLAY_RESOLUTIONS.md` (size classes + test matrix)

## Problem

Every new capability (Wi‑Fi, NAS/SMB, IoT, home automation, …) today tends to become **another nav row** or **another home region**. That works on 1280×720 and breaks on 640×480. Small screens fail because we treat layout as a one-time CSS problem instead of an **information architecture** problem.

**Fix:** plugins never choose layout. They register **destinations** into **planes**. The shell decides what is visible on the landing rest state vs what is one pivot away — from viewport size + capability gates only.

---

## Interaction model: player pivot

Landing = **oblong controls column only** (the protected right half). Everything else is a **pivot reveal** from a centre anchor ●.

```
                    ┌─────────────────┐
                    │  Settings tiles │  ↑ swipe up
                    │  Network · Power│
                    └────────┬────────┘
                             │
    ┌────────────┐     ●     ┌────────────┐
    │  Artwork   │ ← ──── → │ Bio scroll │
    │  full bleed│           │  (tabs)    │
    └────────────┘           └────────────┘
                             │
                    ┌────────┴────────┐
                    │  Library tiles  │  ↓ swipe down
                    │ Queue·Browse·…  │
                    └─────────────────┘

         [ REST: control stack only ]
              title · transport
              progress · volume
                   ●
```

- **Rest (default):** control stack + pivot anchor. No art, no bio, no sidebar.
- **Swipe ← from ●:** artwork overlay (full viewport, dismiss → rest).
- **Swipe → from ●:** bio overlay (scrollable; tabs inside).
- **Swipe ↓ from ●:** library tile sheet (Queue, Playlists, Browse, Favourites, …).
- **Swipe ↑ from ●:** device tile sheet (Settings domains, Power, Update, …).
- **Tap tile:** drill to full-screen surface (standard subpage chrome: ← back).

Gestures originate from ● or its hit halo (~64px), not screen edges — avoids scroll conflicts.

---

## Visibility tiers (what MUST land vs what MAY pivot)

### Tier 0 — Landing invariants (never hidden on rest)

These are the **contract** for small-screen home. A plugin cannot add Tier 0 items without a framework ADR.

| Element | Why invariant | Minimum form |
|---------|---------------|--------------|
| Play / pause / skip | Core transport | 44×44px buttons |
| Track title | Context | 1 line, ellipsis |
| Artist | Context | 1 line, ellipsis |
| Pivot anchor ● | Navigation root | Always visible |
| Connection dot | Trust | 6px status dot in header strip |
| Volume access | Daily control | Speaker icon → step sheet |

### Tier 0 — Conditional (height gate)

| Element | Show when | Hide when |
|---------|-----------|-----------|
| Progress + elapsed | `h ≥ 272` | strip / micro wearable |
| Album line | `h ≥ 320` | very short |
| Classical strip | `h ≥ 360` AND mode ≠ off | short / wearable |
| Visualiser | `h ≥ 400` AND enabled AND standard pivot | small rest (optional in art reveal) |

### Tier 1 — Pivot adjacent (one swipe, no drill)

| Direction | Content | Notes |
|-----------|---------|-------|
| ← | Artwork + optional visualiser | Full-bleed; not beside controls on rest |
| → | Bio (artist / album / lyrics) | Scroll inside panel; horizontal swipe back |
| ↓ | Library tile grid | 4 core tiles + overflow |
| ↑ | Device tile grid | Domain groups + overflow |

### Tier 2 — Drill-in (tap tile → full screen)

All plugin surfaces: queue list, browse tree, Wi‑Fi scan, SMB mount wizard, IoT pairing, etc.

### Tier 3 — Guarded (confirm before action)

Power off, reboot, factory reset, revoke capability, delete share. Never on landing; never single-tap from tile grid.

---

## Planes (scalable nav, not a flat sidebar)

Plugins register into one of five **planes**. Planes map to pivot directions on small screens and to sidebar groups on standard screens — **same registry, different renderer**.

| Plane | Pivot | Standard shell | Examples |
|-------|-------|----------------|----------|
| **listen** | ↓ primary tiles | Listen group | Queue, Browse, Playlists, Favourites, Works |
| **connect** | ↓ overflow / ↑ | Output + network | Multi-room, Cast, Bluetooth, Wi‑Fi, Ethernet |
| **storage** | ↓ overflow | Device (subset) | NAS mount, SMB shares, USB, index paths |
| **automate** | ↓ overflow | Device (subset) | IoT, Home Assistant, scenes, triggers |
| **system** | ↑ primary tiles | Device + Debug | Settings, Alarms, Update, Operations, Power |

New plugins add a **tile descriptor**, not App.tsx nav arrays.

```ts
interface PivotTile {
  id: string;
  plane: "listen" | "connect" | "storage" | "automate" | "system";
  label: string;
  icon: IconId;
  capability: CapabilityKey;      // hidden if missing/unsupported
  minSizeClass: "wearable" | "small" | "standard";
  priority: number;               // lower = shown before "More…"
  surface: Component | lazyRoute;
  landingEligible: false;         // plugins default false — cannot touch Tier 0
}
```

Shell algorithm on small screen:

1. Collect tiles where `capability === supported` and `sizeClass ≥ minSizeClass`.
2. Sort by `priority` within plane.
3. Show top **4** per pivot sheet; remainder behind **More…** (searchable list).
4. Never show more than **8 visible tiles** per sheet without scroll.

---

## Effects vs function (decorative — resolve at implementation)

| Feature | Rest | ← Art | → Bio | Standard desktop |
|---------|------|-------|-------|------------------|
| Album art | hidden | **show** | thumb | oblong left |
| Visualiser | hidden | optional | hidden | oblong stack |
| Spectrum bars | hidden | hidden | hidden | right rail |
| Bio tabs | hidden | hidden | **show** | below player |
| Queue peek | hidden | hidden | hidden | right rail |
| Cast status | dot only | hidden | hidden | aux rail |
| Multi-room badge | dot only | hidden | hidden | Output nav |
| Theme / density | ↑ tile | hidden | hidden | Settings |
| Engineer diagnostics | ↑ More… | hidden | hidden | Debug group |

**Rule:** if it animates, glows, or scrolls for delight but is not required to play music → **never Tier 0**.

---

## Size-class behaviour

| Class | Rest layout | Pivot |
|-------|-------------|-------|
| **wearable** (5 targets) | Strip band OR mini stack; ● required | 4-way; tile sheets scroll |
| **small** (10 targets) | Control stack (oblong right column) | Full pivot model |
| **standard** | Oblong row + rails | Pivot optional; rails primary |

Micro wearable (320×240): progress hidden; volume icon only; library sheet max 4 tiles; device sheet max 3 tiles + More.

---

## Subpage policy on small (extends the subpage-layout policy)

All Tier 2 surfaces share one chrome:

```
┌──────────────────────────┐
│ ←  Surface title         │
├──────────────────────────┤
│  (scrollable body)       │
│                          │
└──────────────────────────┘
```

- Back ← returns to **previous pivot sheet**, not always rest.
- Deep wizards (SMB add user): step indicator top; cancel ← at any step.
- Forms: single column; no side-by-side fields below 800px width.

---

## Why this scales to hundreds of plugins

| Anti-pattern | Pivot architecture |
|--------------|-------------------|
| Add nav item in App.tsx | Register `PivotTile` in plugin module |
| Home layout grows | Home stays Tier 0; plugin goes to plane sheet |
| CSS per feature | Shell renders tiles from registry |
| Break 640×480 when Wi‑Fi ships | Wi‑Fi tile in ↑ connect/system; same rest |
| Duplicate mobile/desktop nav | One registry, two renderers (pivot vs rail) |

---

## Implementation order

1. `presentation-target.ts` — `sizeClass`, `interaction: "pivot" | "strip" | "standard"`.
2. `pivot-registry.ts` — tile types + plane grouping + capability filter.
3. `PivotAnchor` + sheet components (library / device / art / bio overlays).
4. Migrate existing LISTEN/DEVICE/OUTPUT nav items to registry entries.
5. PlaybackSurface rest mode = controls-only branch.
6. Test all 15 wearable + small targets independently (see DISPLAY_RESOLUTIONS §D).

---

## Open decisions

- [ ] ● at geometric centre vs oblong gutter (where art/controls meet when both visible on standard).
- [ ] Bio: single scroll vs tabs on small.
- [ ] "More…" search vs alphabetical vs recent.
- [ ] Whether connect + storage share one ↓ overflow or split ↓ listen / ↑ system only.

---

## Network design session (browser composer)

The **display is a singleton runtime** — one viewport, pivot rules enforced on device.  
The **designer runs in a browser session over the network** — mouse, space, drag-and-drop.

| | Display runtime (target) | Design session (source) |
|--|--------------------------|-------------------------|
| Where | Physical panel / kiosk | Laptop, tablet browser |
| Role | Render applied config | Author layout + appearance |
| DnD | No (problematic on miniature) | Yes — on preview frame |
| Preview | Live output | Iframe at exact target W×H |

Miniature screen = **validation target**, not editor surface. Config flows via gateway settings (same path as `ui.theme`, `ui.density` today).

Entry: Settings → **Layout & appearance** on large viewports, or “Open designer on another device” + link/QR from the panel.

---

## Appearance stack (theme-derived)

The designer must preview **layout and appearance together**. All visual properties derive from a single token pipeline — device and preview iframe share identical CSS.

### Layer model

```
Theme (palette + semantics)
    ↓
Typography (family + type ramp)
    ↓
Scale (root rem × density × display factor)
    ↓
Layout overlay (tile order, Tier 1 extras)
    ↓
Rendered preview @ target W×H
```

### 1. Theme — colour scheme (existing)

Themes already expose semantic tokens on `:root` / `.theme-*`:

`--background`, `--foreground`, `--primary`, `--accent`, `--muted`, `--border`, `--status-ok`, …

Designer behaviour:

- **Pick theme** from the five shipped ids above — read-only palette preview from tokens.
- Persist: `ui.theme` (already wired).

### 2. Typography — font type + ramp

Today: Inter @ 400/600 on `:root`. Designer should expose:

| Control | Scope | Notes |
|---------|-------|-------|
| **UI font** | Shell, tiles, settings | Theme may override family later |
| **Monospace font** | Diagnostics, queue indices | Separate stack; never on landing Tier 0 |
| **Type ramp** | Stepped roles, not px per element | See below |

**Type ramp** (CSS custom properties, theme-scoped):

```css
--type-title:   clamp(1rem, 4vw, 1.75rem);   /* track title on rest */
--type-body:    1rem;
--type-caption: 0.85rem;
--type-label:   0.75rem;                      /* tile labels */
--type-weight-title: 600;
--type-weight-body: 400;
```

Designer: sliders or presets (**Small / Default / Large**) adjust ramp steps — preview shows title ellipsis and tile label wrap at target resolution.

Persist: `ui.typography.profile` or nested in layout document.

### 3. Scale — three knobs (orthogonal)

| Knob | What it scales | Already exists? |
|------|----------------|-----------------|
| **Root scale** | `html { font-size }` — rem-based layout rides this | Cinema `@media` bumps to 20px |
| **Density** | Vertical rhythm + art frame (`comfortable` / `compact`) | `ui.density`, `[data-density]` |
| **Display factor** | Per-target multiplier for small panels | **New** — designer key feature |

**Display factor** example: 800×480 kiosk at arm’s length may need `1.0`; 480×272 strip may need `1.15` so transport hits 44px min without breaking layout.

Computed on device:

```css
html {
  font-size: calc(
    var(--display-base-px, 16px)
    * var(--display-factor, 1)
    * var(--cinema-scale, 1)
  );
}
```

Designer shows **effective px** readout: “Title ≈ 18px at 480×272 with factor 1.15”.

### Display profile policy (decided)

UI profile key = **display preset id** when known, not W×H alone.

| Input | Drives |
|-------|--------|
| **Effective W×H** | Layout shape — pivot, strip, bar, oblong row vs stack |
| **Preset id + physical diagonal** | Visual scale, touch targets, typography comfort |
| **Runtime orientation** | Swaps W×H → may change layout family; physical diagonal unchanged |

**Why 67 W×H is not enough:** from `display_presets.json` v1.5.9 — 30 unique effective sizes, but **181 presets** share a W×H with another preset at a **different diagonal**. Example: `800×480` × 57 presets (4″–8″); `1920×1080` × 10 presets (5.5″–15.6″).

**Test matrix (facts):**

1. **Per preset (~192)** — layout + scale pass/fail; store defaults in framework catalogue.
2. **Per effective W×H (67 grid)** — extract layout *patterns* only after preset evidence; never replace preset testing.
3. **Custom / projector / `auto`** — designer captures W×H + physical diagonal (inches) + viewing context; saves as custom profile.

**Runtime lookup:**

```ts
profile =
  ui.profile.byPreset[presetId]           // primary
  ?? ui.profile.custom                    // custom-hdmi / designer
  ?? frameworkDefault.byPreset[presetId]
  ?? frameworkDefault.byWH[`${w}x${h}`];   // last resort — layout only, scale may be wrong
```

**Settings shape (per preset, not three class buckets):**

```json
{
  "ui.profile": {
    "byPreset": {
      "waveshare-4.3-hdmi": {
        "displayFactor": 1.2,
        "typography": "large",
        "layout": { "libraryTiles": ["queue", "browse"] }
      }
    },
    "custom": {
      "effectiveWH": "1920x1080",
      "diagonalInches": 100,
      "viewingContext": "room",
      "displayFactor": 0.95
    }
  }
}
```

Framework ships **default profile per preset** (~192 entries, derived from catalogue + testing). Operator overrides in browser designer apply to **the preset being previewed**. Size class (`wearable` / `small` / `standard`) remains a **computed label** for interaction mode only — not storage for scale or layout.

**Portrait / landscape:** effective W×H changes when the panel rotates; if both orientations are used, treat as two runtime states (two W×H keys) with the **same preset id** and diagonal. Test both when the product allows rotation.

### 4. What designer edits vs derives

| User edits | Derived automatically from theme |
|------------|----------------------------------|
| Theme choice | All `--primary`, `--background`, … |
| Typography profile | Contrast-safe `--foreground` on `--background` |
| Display factor | Touch target min sizes (warn if &lt; 44px) |
| Tile order / visibility | Icon tint from `--primary` / `--muted-foreground` |
| Tier 1 landing extras | — |

Designer **warns**, does not block: “Skip button 38px — increase display factor or use Large type.”

### 5. Preview fidelity

Preview iframe loads shell with:

```html
<html
  class="theme-night-sky"
  data-density="compact"
  data-size-class="small"
  data-interaction="pivot"
  style="--display-w: 480px; --display-h: 272px; --display-factor: 1.1;"
>
```

Same bundle, same CSS, same tokens as device — not a mockup component library.

Side panel in designer:

- **Preset picker** (primary — from DISPLAY_RESOLUTIONS §E, ~192 targets)
- Effective W×H readout + optional orientation toggle
- Physical diagonal (inches) — from preset or operator entry for custom/projector
- Theme dropdown — **5 existing themes** (`THEME_OPTIONS` in `App.tsx`)
- Typography preset
- Density toggle
- Display factor slider (with PPI / angular size readout)
- Layout tile editor

Changing any control re-renders preview without apply; **Apply** writes atomic settings patch to device.

### 6. Settings payload (sketch)

```json
{
  "ui.theme": "night-sky",
  "ui.density": "compact",
  "ui.typography.profile": "default",
  "ui.profile": {
    "byPreset": {
      "generic-800x480": { "displayFactor": 1.0, "typography": "default" }
    }
  },
  "ui.layout.small": {
    "libraryTiles": ["queue", "browse", "playlists", "favourites"],
    "deviceTiles": ["settings", "network.wifi", "power"],
    "landingExtras": { "progress": true, "albumLine": false }
  }
}
```

Layout and appearance are separate keys but edited in **one designer session** so operators see the full picture.

### 7. Non-goals (appearance)

- Raw colour picker bypassing theme tokens (breaks consistency + contrast).
- Per-element font sizes in designer (use ramp + scale only).
- Different theme on preview vs device after apply.
- Typography that shrinks Tier 0 controls below touch minimum.

---

## Open decisions (design session)

- [ ] Typography profiles: 3 presets vs continuous slider?
- [ ] Live preview on physical device before apply (10s draft overlay)?
