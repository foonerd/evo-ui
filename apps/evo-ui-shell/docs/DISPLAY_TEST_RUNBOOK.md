# Display test runbook

**Primary test surface: the browser designer on your LAN** — not the miniature panel, not `localhost:5173` unless you are actively coding the shell.

You iterate in the **designer** (preset picker + exact W×H preview). You swap **MIPI / HMI / DSI / SPI / HDMI** hardware only when there is something worth confirming on a real panel.

---

## Three runtimes (one product)

| Runtime | Where | Your workflow |
|---------|-------|---------------|
| **Designer** | Laptop browser → rig UI over network | **Day-to-day layout testing** |
| **Display** | Attached panel | Confirm when hardware is wired |
| **Framework** | Gateway settings on rig | Apply / persist profiles (designer v2) |

---

## 1. Deploy once (any rig)

```bash
cd apps/evo-ui-shell && npm run build
cd ../evo-ui-runtime
./scripts/device/deploy-runtime-service-pi.sh <user>@<rig-host-or-ip>
```

Examples: `<service-user>@<aarch64-rig>` · `<service-user>@<x86-bare-metal-rig>` · `<service-user>@<x86-vm-rig>`

---

## 2. Designer URI — where you test layouts

From a **laptop on the same LAN**, open:

```text
http://<rig-host-or-ip>/?designer=1
```

Legacy alias (same UI): `?display-test=1`

Without gateway / playback backend:

```text
http://<rig-host-or-ip>/?designer=1&mock=1
```

**What you get**

- **67 known screen sizes** from the display catalogue (Compact / Small / Standard panels · Mobile · Tablet)
- **Primary screen** — Auto / Panel / Mobile / Tablet (default **Auto**; sets `data-device-kind` on preview)
- **Apply to device** — saves primary screen + preview W×H to gateway `ui.profile`
- **Landscape / Portrait** toggle — swaps width and height for the same pick
- Live preview of Home at the exact pixel size
- Footer hint: compact navigation vs full layout (no engineering jargon)

---

## 3. What to verify in the designer (before hardware)

Record pass/fail in `DISPLAY_RESOLUTIONS.md` §D against the **preset id + effective W×H**, not “looked OK on laptop”.

| Preset class | Example | Designer checks |
|--------------|---------|-----------------|
| Wearable / strip | 480×272 · 480×320 | Primary screen **Panel** (or Auto); `interaction=pivot`; rest = controls + **●** |
| Mobile companion | 390×844 portrait + landscape | Primary screen **Mobile**; `device-kind=mobile`; `interaction=standard` (not pivot) |
| Tablet companion | 768×1024 both orientations | Primary screen **Tablet**; scroll layout |
| Split kiosk | `generic-800x480` | Oblong row; controls never clip |
| Full / 7K | `generic-720p` 1280×720 | Oblong + context; `data-kiosk7k` in readout |
| Bar | `waveshare-11.9-hdmi` 1480×320 | `fold-tier=bar`; short-height band |
| DSI portrait | `waveshare-dsi-v2-5.0a` (720×1280 native) | Rotated effective size in picker |

### Pivot checklist (when readout says `interaction=pivot`)

| Step | Action | Pass |
|------|--------|------|
| 1 | Home | No art on rest; no sidebar |
| 2 | ● / arrows | Art, bio, library, device overlays |
| 3 | Tile tap | Navigates (e.g. Queue) |
| 4 | Rest | Back to controls + ● |

---

## 4. Hardware confirmation (when you choose)

When the designer row is green and you have wired a panel:

```text
http://<rig-host-or-ip>/
```

Optional corner readout on the **physical** viewport:

```text
http://<rig-host-or-ip>/?layout-debug=1
```

Compare panel to designer preview for the same preset id. Touch and inches are validated here — not in the designer frame.

---

## 5. Local dev only (engineers changing shell code)

```bash
cd apps/evo-ui-shell && npm run dev
```

```text
http://localhost:5173/?designer=1&mock=1
```

Same designer UI; used while editing TypeScript/CSS before deploy. **Not** the operator test path once a build is on the rig.

---

## Automated contracts (CI / dev host)

```bash
cd apps/evo-ui-shell && npm run test:display
```

Guards the fold / size-class decision tree — supplements, does not replace, designer rows in §D.

---

## Engineering bar

Fill `ENGINEERING_BAR.md` per PR. Layout changes need a **designer preset row** in §D; hardware note when a physical panel was used for confirmation.
