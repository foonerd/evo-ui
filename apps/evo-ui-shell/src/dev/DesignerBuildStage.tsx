// Build canvas - the mockup-v3 interaction model against the real
// document. Replaces the live preview in the designer stage while
// the Pages tab is active: a panel at true aspect (same fit-to-stage
// scaling as the preview frame) whose regions are drop surfaces.
//
// - Drag a palette widget (sidebar) onto main / rail / deck: it
//   lands where you drop it, at its ideal size clamped into the
//   region's legal set.
// - Drag a placed chip onto another chip (insert before) or onto a
//   region (append); cross-region moves clamp the size or refuse
//   with the contract reason (toast).
// - Click a chip to select it; the sidebar inspector edits size,
//   alignment, fold priority, and removal. Alignment pins are
//   rendered here exactly as the device renders them
//   (gridColumnFor is shared with DocPageView).
//
// Chips are schematic blocks (label + kind + size), not live
// surfaces: the designer has no live playback substrate, and the
// Live preview remains one tab away for fidelity. Unavailable or
// refused slots stay VISIBLE here as ghosts with the reason - the
// designer is exactly the place where those must be seen.

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LayoutTemplate } from "lucide-preact";

import { t } from "../runtime/i18n";
import { useStageEditor } from "./stage-editor-state";

import { gridColumnFor } from "../app/DocPageView";
import { curatableNavDefaults } from "../app/App";
import {
  APP_CONTRACT_KINDS,
  catalogKind,
  catalogSnapshot,
  VIEW_PAGE_DEFAULTS
} from "../app/widget-catalog";
import { usePresentation } from "../runtime/presentation-context";
import { foldMinPriority } from "../runtime/presentation-target";
import {
  PAGE_REGIONS,
  resolveLayout,
  type LayoutDocument,
  type PageRegionId,
  type ResolvedSlot
} from "../runtime/layout-document";
import { breakpointFor } from "../runtime/composition";
import { useDesignerScope } from "./designer-scope";
import { mergeScopedLayout, resolveScopedLayout } from "./designer-layout-io";
import {
  addPage,
  editablePages,
  insertWidgetAt,
  moveSlot,
  synthesizeHomePage,
  synthesizeViewPage,
  type SlotAddress
} from "./designer-pages";

export interface BuildSelection {
  readonly pageId: string;
  readonly address: SlotAddress;
}

export interface BuildStageProps {
  readonly pageId: string | null;
  readonly onPageChange: (pageId: string) => void;
  readonly selection: BuildSelection | null;
  readonly onSelect: (selection: BuildSelection | null) => void;
}

interface DragPayload {
  readonly src: "palette" | "slot";
  readonly kind?: string;
  readonly region?: PageRegionId;
  readonly index?: number;
}

const REGION_IDS: readonly PageRegionId[] = ["main", "rail", "deck"];

export function DesignerBuildStage(props: BuildStageProps): JSX.Element {
  const { profileSettings, setProfileSettings, plan, viewportOverride } =
    usePresentation();
  const { scope } = useDesignerScope();
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const w = viewportOverride?.widthPx ?? 1280;
  const h = viewportOverride?.heightPx ?? 720;

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const fit = () => {
      const pad = 56;
      const availW = Math.max(120, stage.clientWidth - pad);
      const availH = Math.max(120, stage.clientHeight - pad);
      setScale(Math.min(1, availW / (w + 24), availH / (h + 24)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [w, h]);

  const doc = useMemo(
    () => resolveScopedLayout(scope, plan.targetKey, profileSettings),
    [scope, plan.targetKey, profileSettings]
  );
  const pages = editablePages(doc);
  const page = pages.find((p) => p.id === props.pageId) ?? pages[0] ?? null;

  const resolved = useMemo(() => {
    if (doc === null || page === null) return null;
    const layout = resolveLayout(doc, catalogSnapshot(), breakpointFor(w));
    return layout.pages.find((p) => p.page.id === page.id) ?? null;
  }, [doc, page, w]);

  // The canvas simulates the selected screen: its fold floor marks
  // which chips the device would shed at this size.
  const minFold = foldMinPriority(plan.foldTier);

  const showToast = (text: string, error: boolean) => {
    setToast({ text, error });
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  };

  const commit = (next: LayoutDocument) => {
    // A native write without a target key has nowhere to go - refuse
    // VISIBLY (toast), never accept an edit that silently vanishes.
    if (scope !== "remote" && plan.targetKey == null) {
      showToast("No screen selected - pick a panel first", true);
      return;
    }
    setProfileSettings(
      mergeScopedLayout(scope, profileSettings, plan.targetKey, next)
    );
  };

  const handleDrop = (
    ev: DragEvent,
    region: PageRegionId,
    beforeIndex: number | null
  ) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (doc === null || page === null) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(
        ev.dataTransfer?.getData("text/plain") ?? ""
      ) as DragPayload;
    } catch {
      return;
    }
    if (payload.src === "palette" && payload.kind !== undefined) {
      const kind = catalogKind(payload.kind);
      if (kind === undefined) return;
      const result = insertWidgetAt(doc, page.id, kind, {
        region,
        index: beforeIndex
      });
      if (result.refusal !== null) {
        showToast(`refused: ${result.refusal}`, true);
        return;
      }
      commit(result.doc);
      if (result.address !== undefined) {
        props.onSelect({ pageId: page.id, address: result.address });
      }
      return;
    }
    if (
      payload.src === "slot" &&
      payload.region !== undefined &&
      payload.index !== undefined
    ) {
      const from: SlotAddress = { region: payload.region, index: payload.index };
      const slot = page.regions[from.region]?.[from.index];
      const kind = slot !== undefined ? catalogKind(slot.widgetKindId) : undefined;
      const result = moveSlot(
        doc,
        page.id,
        from,
        { region, index: beforeIndex },
        kind
      );
      if (result.refusal !== null) {
        showToast(`refused: ${result.refusal}`, true);
        return;
      }
      commit(result.doc);
      if (result.address !== undefined) {
        props.onSelect({ pageId: page.id, address: result.address });
      }
    }
  };

  const allowDrop = (ev: DragEvent) => {
    ev.preventDefault();
  };

  return (
    <section className="designer-canvas" aria-label="Build canvas">
      <header className="designer-canvas-head">
        <span className="designer-canvas-label">Build</span>
        <span className="designer-build-pages">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                page !== null && page.id === p.id
                  ? "designer-build-pagechip designer-build-pagechip-active"
                  : "designer-build-pagechip"
              }
              onClick={() => {
                props.onPageChange(p.id);
                props.onSelect(null);
              }}
            >
              {p.name}
            </button>
          ))}
          {!pages.some((p) => p.id === "home") ? (
            <button
              type="button"
              className="designer-build-pagechip designer-build-pagechip-default"
              title="Edit the home page (the device already renders this default: now-playing on main, coming-next and volume on the rail). Removing the page returns to the shipped default."
              onClick={() => {
                const result = synthesizeHomePage(doc);
                commit(result.doc);
                props.onPageChange(result.pageId);
                props.onSelect(null);
              }}
            >
              Home
            </button>
          ) : null}
          {VIEW_PAGE_DEFAULTS.filter(
            (def) => !pages.some((p) => p.id === def.viewId)
          ).map((def) => (
            <button
              key={def.viewId}
              type="button"
              className="designer-build-pagechip designer-build-pagechip-default"
              title={`Default page - editing forks it into your layout; removing the page restores the built-in ${def.name} view`}
              onClick={() => {
                const result = synthesizeViewPage(doc, def);
                commit(result.doc);
                props.onPageChange(result.pageId);
                props.onSelect(null);
              }}
            >
              {def.name}
            </button>
          ))}
          <button
            type="button"
            className="designer-build-pagechip designer-build-pagechip-add"
            onClick={() => {
              const result = addPage(
                doc,
                `Page ${pages.length + 1}`,
                curatableNavDefaults()
              );
              commit(result.doc);
              props.onPageChange(result.pageId);
              props.onSelect(null);
            }}
          >
            + page
          </button>
        </span>
        <span className="designer-canvas-badge">{w}x{h}</span>
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
            {page === null || resolved === null ? (
              <div
                className="designer-build-empty"
                style={{ width: `${w}px`, height: `${h}px` }}
              >
                <p>
                  No custom pages on this screen yet. Press "+ page" above,
                  then drag widgets from the palette in the Pages tab.
                </p>
              </div>
            ) : (
              <div
                className="designer-build-panel"
                style={{ width: `${w}px`, height: `${h}px` }}
                onClick={() => props.onSelect(null)}
              >
                <div
                  className={`designer-build-body designer-build-body-rail-${page.railPosition ?? "right"}`}
                >
                  <BuildRegion
                    region="main"
                    slots={resolved.regions.main ?? []}
                    pageId={page.id}
                    selection={props.selection}
                    onSelect={props.onSelect}
                    onDrop={handleDrop}
                    onDragOver={allowDrop}
                    minFoldPriority={minFold}
                  />
                  {/* Off is off: the canvas must not reserve space the
                      device will never render. The rail's widgets stay
                      in the document; flip the rail back to any edge
                      in Pages to see and edit them. */}
                  {page.railPosition !== "off" ? (
                    <BuildRegion
                      region="rail"
                      slots={resolved.regions.rail ?? []}
                      pageId={page.id}
                      selection={props.selection}
                      onSelect={props.onSelect}
                      onDrop={handleDrop}
                      onDragOver={allowDrop}
                      minFoldPriority={minFold}
                      railOpacity={page.railOpacity}
                    />
                  ) : null}
                </div>
                <BuildRegion
                  region="deck"
                  slots={resolved.regions.deck ?? []}
                  pageId={page.id}
                  selection={props.selection}
                  onSelect={props.onSelect}
                  onDrop={handleDrop}
                  onDragOver={allowDrop}
                  minFoldPriority={minFold}
                />
              </div>
            )}
          </div>
        </div>
        {toast !== null ? (
          <p
            className={
              toast.error
                ? "designer-build-toast designer-build-toast-error"
                : "designer-build-toast"
            }
            role={toast.error ? "alert" : "status"}
          >
            {toast.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BuildRegion(props: {
  region: PageRegionId;
  slots: readonly ResolvedSlot[];
  pageId: string;
  selection: BuildSelection | null;
  onSelect: (selection: BuildSelection | null) => void;
  onDrop: (ev: DragEvent, region: PageRegionId, beforeIndex: number | null) => void;
  onDragOver: (ev: DragEvent) => void;
  minFoldPriority?: number;
  /** Rail surface opacity (page data) - canvas mirrors the device. */
  railOpacity?: number;
}): JSX.Element {
  const { region } = props;
  return (
    <div
      className={`designer-build-region designer-build-region-${region}`}
      data-region={region}
      style={
        region === "rail" && props.railOpacity !== undefined
          ? { "--rail-bg-alpha": String(props.railOpacity) }
          : undefined
      }
      onDragOver={props.onDragOver}
      onDrop={(ev) => props.onDrop(ev as unknown as DragEvent, region, null)}
    >
      <span className="designer-build-region-label">
        {region} ({PAGE_REGIONS[region].acceptsSizes.join(", ")})
      </span>
      {props.slots.map((resolved, index) => (
        <BuildChip
          key={`${resolved.slot.widgetKindId}:${index}`}
          resolved={resolved}
          region={region}
          index={index}
          pageId={props.pageId}
          selection={props.selection}
          onSelect={props.onSelect}
          onDrop={props.onDrop}
          onDragOver={props.onDragOver}
          minFoldPriority={props.minFoldPriority}
        />
      ))}
    </div>
  );
}

function BuildChip(props: {
  resolved: ResolvedSlot;
  region: PageRegionId;
  index: number;
  pageId: string;
  selection: BuildSelection | null;
  onSelect: (selection: BuildSelection | null) => void;
  onDrop: (ev: DragEvent, region: PageRegionId, beforeIndex: number | null) => void;
  onDragOver: (ev: DragEvent) => void;
  /** Fold floor of the simulated screen; chips below it fold on the
   *  device and render dimmed with a "folds" badge here - the canvas
   *  shows what the panel drops instead of hiding it. */
  minFoldPriority?: number;
}): JSX.Element {
  const { resolved, region, index } = props;
  const slot = resolved.slot;
  const stageEd = useStageEditor();
  const kind = catalogKind(slot.widgetKindId);
  const selected =
    props.selection !== null &&
    props.selection.pageId === props.pageId &&
    props.selection.address.region === region &&
    props.selection.address.index === index;
  const status = resolved.status.kind;
  const folds =
    !APP_CONTRACT_KINDS.has(slot.widgetKindId) &&
    slot.foldPriority < (props.minFoldPriority ?? 1);
  const style =
    region === "main"
      ? { gridColumn: gridColumnFor(resolved.effectiveSize, slot.widgetKindId === "evo.app.nowplaying" ? "center" : slot.align) }
      : undefined;
  return (
    <div
      className={
        "designer-build-chip" +
        (selected ? " designer-build-chip-selected" : "") +
        (status !== "admitted" ? ` designer-build-chip-${status}` : "") +
        (folds ? " designer-build-chip-folds" : "")
      }
      style={style}
      draggable
      data-widget-kind={slot.widgetKindId}
      title={
        folds
          ? `folds away on this screen (priority ${slot.foldPriority} < tier floor ${props.minFoldPriority})`
          : status === "admitted"
            ? undefined
            : (resolved.status as { reason?: string }).reason
      }
      onClick={(ev) => {
        ev.stopPropagation();
        props.onSelect({
          pageId: props.pageId,
          address: { region, index }
        });
      }}
      onDragStart={(ev) => {
        ev.stopPropagation();
        (ev as unknown as DragEvent).dataTransfer?.setData(
          "text/plain",
          JSON.stringify({ src: "slot", region, index })
        );
      }}
      onDragOver={props.onDragOver}
      onDrop={(ev) => {
        (ev as unknown as Event).stopPropagation();
        props.onDrop(ev as unknown as DragEvent, region, index);
      }}
    >
      <span className="designer-build-chip-name">
        {kind?.label ?? slot.widgetKindId}
        {slot.widgetKindId === "evo.app.nowplaying" ? (
          <button type="button" className="designer-build-chip-enter"
            title={t("builder.editStageHelp")}
            onClick={(ev) => {
              ev.stopPropagation();
              props.onSelect(null);
              stageEd.enterStage(props.pageId);
            }}>
            <LayoutTemplate size={12} /> {t("builder.editStage")}
          </button>
        ) : null}
      </span>
      <span className="designer-build-chip-meta">
        {slot.widgetKindId} - {resolved.effectiveSize}
        {slot.align !== undefined ? ` - ${slot.align}` : ""}
      </span>
      {status !== "admitted" ? (
        <span className="designer-build-chip-status">{status}</span>
      ) : folds ? (
        <span className="designer-build-chip-status">folds</span>
      ) : null}
    </div>
  );
}
