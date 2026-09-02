# Evo UI shell — architecture (one page)

**Status:** canonical alignment doc — 2026-06-05  
**Read this first.** Detail lives in linked docs; this is what “same page” means.

**Every task / PR:** answer the six questions in [`ENGINEERING_BAR.md`](./ENGINEERING_BAR.md) before merge.

**Manual layout testing:** [`DISPLAY_TEST_RUNBOOK.md`](./DISPLAY_TEST_RUNBOOK.md) — **`http://<rig>/?designer=1`** from laptop on LAN; hardware (MIPI/DSI/HMI/SPI) when confirming a green designer row.

## The duo: versatility + practicality

| | Versatility | Practicality |
|--|-------------|--------------|
| **Means** | One shell runs on every panel, every plugin, portrait/landscape | Defaults work on hardware without tuning; tuning is optional and off-device |
| **Not** | Infinite CSS per feature | 67 sliders, guesswork, or design on a 2.8″ screen |
| **How** | Registry + planes + pivot/rail modes | Preset catalogue → shipped defaults → browser designer to override |

If a proposal adds layout surface area without registry discipline, reject it.  
If a proposal requires per-plugin CSS hacks, reject it.

---

## One sentence

**The device knows which panel it is; the shell picks layout from viewport shape and scale from physical panel; plugins register destinations, never landing chrome; operators tune in a browser designer, not on the miniature display.**

---

## Two inputs (never confuse them)

```
┌─────────────────────┐     ┌─────────────────────┐
│  VIEWPORT SHAPE     │     │  PHYSICAL PANEL     │
│  effective W × H    │     │  preset id + inches │
│  (+ rotation)       │     │  (from catalogue)   │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           ▼                           ▼
      LAYOUT MODE                  UI SCALE
   pivot / strip / bar /        type size, touch
   oblong row vs stack          comfort, density
```

**Third axis — primary screen kind** (`panel | mobile | tablet`, default **`auto`**):

| Kind | Role |
|------|------|
| **panel** | Embedded HDMI / DSI / DPI — pivot on compact/small, rails on standard |
| **mobile** | Phone companion — scroll-native; portrait + landscape |
| **tablet** | Tablet companion — scroll + split where width allows |
| **auto** | Resolve from profile → matrix row → viewport heuristics → **panel** |

Set in **browser designer** (“Primary screen”) and persist per preset in `ui.profile.*.deviceKind`. Same W×H can differ by kind (720×1280 Pi panel ≠ phone browser).

**Same pixels, different inches → same layout family possible, different scale required.**  
Example: 800×480 on 4″ ≠ 800×480 on 8″. Example: 1080p on 5.5″ ≠ 1080p on 100″ projector.

That is why the **display preset catalogue** (~192 hardware profiles) is the primary identity — not “67 resolutions.”

---

## Three runtimes (one product)

| Runtime | Where | Job |
|---------|-------|-----|
| **Display** | Panel / kiosk | Render. Singleton. Touch. No editor. |
| **Designer** | Browser on network | Preview true size + preset. Drag tiles. Tune scale. Apply config. |
| **Framework** | Gateway + settings | Store profile per preset. Capability gates. Sync to device. |

Miniature screen = **target**. Laptop browser = **workshop**.

---

## Landing page contract (frozen)

**Tier 0 — always on rest (small + large):** transport, title, artist, pivot ●, connection, volume access.  
**Never Tier 0:** art, bio, queue, visualiser, plugin settings, nav sidebar on small.

Everything else is **pivot, tile, or drill-in** — see `SMALL_SCREEN_PIVOT.md`.

---

## Small screen navigation (decided)

**Player pivot** — rest = control stack only. From centre ●:

- ← artwork  
- → bio  
- ↓ library tiles (queue, browse, playlists, …)  
- ↑ device tiles (settings, network, power, …)  

No sidebar. No bottom nav strip on wearable/small pivot mode.

---

## Plugins (how hundreds fit)

Plugins **register tiles** into a plane: `listen | connect | storage | automate | system`.  
They do **not** edit App.tsx nav, landing layout, or CSS per plugin.

Shell renders top N tiles + **More…** overflow. New Wi‑Fi / NAS / IoT plugin = new tile in a plane, not a new home region.

---

## Profiles (what we store)

**Primary key:** `display preset id` from `display_presets.json` (~192 parseable).  
**Fallback:** custom profile (operator sets W×H + diagonal inches for projector / unknown HDMI).

Each profile bundles: layout tiles, typography step, display factor, theme id (theme supplies colours).

**Size class** (`wearable | small | standard`) = computed label for **interaction mode only**. Not a storage bucket for scale.

**67 W×H grid** = supplementary layout-pattern checklist. Useful after preset testing; **does not replace** preset profiles.

---

## Testing (facts, not guesswork)

1. Test **each preset** you ship (or each preset class you support).  
2. If rotation matters, test **both** effective W×H states.  
3. Record pass/fail in catalogue appendix — patterns come **after** rows are green.  
4. Do not collapse presets into “close enough” W×H for sign-off.

---

## Document map (read order)

| Doc | Purpose |
|-----|---------|
| **This file** | Alignment — versatility + practicality |
| `DISPLAY_RESOLUTIONS.md` | Preset appendix + W×H grid + test table |
| `SMALL_SCREEN_PIVOT.md` | Pivot interaction, designer session, appearance tokens |
| `docs/RESPONSIVE_FOLD_MODEL.md` | Fold tiers (solo/strip/bar/stack/split/full/cinema) |
| Landing layout brief (Retired) | Oblong geometry, region priority |

When AI or humans disagree, **this page wins** until you explicitly revise it.

---

## Decision ledger — do I need to discuss more?

Use this table only. **Green = decided, build.** **Yellow = your call when convenient (defaults exist).** **Red = not architecture; discover while building/testing.**

### Green — locked (no further discussion)

| Topic | Decision |
|-------|----------|
| Goal | Versatility + practicality |
| Display identity | Preset catalogue (~192), not W×H-only |
| Layout vs scale | W×H → shape; inches → how big UI looks |
| Small-screen nav | Player pivot on **panel** compact/small; not on mobile/tablet |
| Primary screen kind | `panel \| mobile \| tablet \| auto` — designer + profile; default **auto** |
| Landing rest | Controls + Tier 0 (panel pivot); mobile/tablet use scroll layout (TBD chrome) |
| Plugins | Tile registry / planes; never landing chrome |
| Designer location | Browser over network, not on miniature panel |
| Designer inputs | H px, V px, inches, **primary screen**, theme selector + tiles |
| Profile persist | **`ui.profile`** — deviceKind, displayFactor (Apply in designer) |
| Themes | Five shipped ids — select only, do not author in designer |
| Testing | Preset-by-preset evidence; patterns after rows pass |
| Standard layout | Oblong + fold model (existing docs) |

**If it’s green, discussing again is optional refinement — not a blocker.**

### Yellow — open but defaults OK (decide when you want, or accept default)

| Topic | Default if you skip |
|-------|---------------------|
| ● anchor position | Centre on pivot screens |
| Bio in pivot → | Tabs when tall enough, else single scroll |
| “More…” overflow | Search |
| Which plane on ↑ vs ↓ | Listen ↓; connect/storage/automate/system ↑ |
| Typography in designer | Reuse density + display factor first; no extra knob in v1 |
| Inches in JSON | Parse from preset name until explicit field added |
| **Panel default landing** | **`smallLanding`:** `compass` (default) or `track` — panel compact only |
| **Idle screen** | **Full-screen clock** when not playing (see below) |

### Idle screen (direction set — v1 simple, refine later)

When playback is idle for a configured interval, the display switches to a **full-screen simple clock** — not the player pivot.

| Aspect | v1 now | Later (plugin + Appearance) |
|--------|--------|-------------------------------|
| **Clock** | Simple digital time (minimal) | Style, date, seconds, next-alarm hint |
| **Settings** | Idle timeout only if needed | **Appearance** settings surface |
| **Enter idle** | No playback for N minutes | Same |
| **Exit idle** | Touch → player; playback/alarm as today | Same |
| **Mode** | `data-display-mode="idle" \| "player"` | Same |

Refinement (flip/analog, density, OLED contrast) waits for **full alarm/scheduler plugin work** — not architecture discussion now.

**Yellow items change UX polish, not whether the system works.**

### Red — resolve in implementation / test (not in design meetings)

| Topic | When |
|-------|------|
| inches → display factor formula | First 2–3 real panels |
| Designer route / iframe wiring | After pivot rest view ships |
| Default profile JSON for all ~192 presets | Start with presets you ship; expand |
| Live preview on device before Apply | v2 designer |
| 7K overlay, cinema scale | When those presets fail test rows |

**Red means: build, test, fix — not more architecture chat.**

---

## “Am I missing something?” — three questions

Ask yourself:

1. **Can I describe the product in one sentence?** (See top of this doc.) → If yes, core architecture is enough.
2. **Is anything blocking code?** → Only green items should block; yellow has defaults.
3. **Am I trying to solve implementation detail in a design meeting?** → That’s red — resolve at implementation.

You do **not** need to feel certainty about every pixel. You need **green locked**, **yellow defaulted**, **red routed to implementation**.

---

## Explicit non-goals

- Free-form drag on the 2.8″ panel  
- Raw hex colour picker bypassing theme  
- Plugins on Tier 0 landing  
- Width-only breakpoints as sole layout driver  
- “67 resolutions is enough” for UI sign-off  
- Three magic scale presets instead of preset catalogue  

---

## Implementation sequence (practical order)

1. `presentation-target.ts` — preset id + effective W×H → layout mode + size class  
2. Pivot rest view + ● anchor (controls-only landing)  
3. `pivot-registry.ts` — planes + capability filter  
4. Migrate existing nav items to registry  
5. Framework default profile JSON per preset (start with clusters, expand)  
6. Browser designer route (preview iframe + apply settings)  
7. Fill test table preset-by-preset  

Ship defaults that work; designer is enhancement, not requirement for first boot.

---

## Designer controls (foreseen)

Browser session — three inputs, selectors or sliders:

| Control | Input | Role |
|---------|--------|------|
| **Horizontal** | px selector/slider | Effective viewport width |
| **Vertical** | px selector/slider | Effective viewport height |
| **Screen size** | inches selector/slider | Physical diagonal — scale / touch comfort |
| **Primary screen** | Auto / Panel / Mobile / Tablet | Device kind — default **Auto** |

**Preset picker (recommended first step):** choosing a catalogue preset fills all three from `display_presets.json` (W×H from native + rotation; inches from preset name until JSON carries an explicit field). Sliders then **override** for custom HDMI, projector, or “what-if.”

**Preview:** iframe at exactly H×V px, profile scale derived from inches (warn if Tier 0 controls &lt; 44px effective).

**Apply:** writes `ui.profile` for preset id, or `ui.profile.custom` with `{ w, h, diagonalInches }` when no preset.

**Theme:** selector only — **five themes already shipped** in `App.tsx` + `styles.css` (designer does not author palettes):

| id | Label |
|----|-------|
| `evo-default` | Evo Default |
| `night-sky` | Night Sky |
| `sunrise` | Sunrise |
| `air` | Air |
| `liquid` | Liquid |

Persisted as `ui.theme` (already wired to gateway settings). Preview applies `theme-{id}` class; colours derive from semantic tokens (`--primary`, `--background`, …).

No design on the device — H/V/inches + **theme pick** + tile layout in the workshop.
