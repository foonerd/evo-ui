// Designer Pages tab - the v7 builder chrome applied to page
// composition: an OUTLINE of page cards (regions > widget chips with
// envelope notes) with hover actions, "+" per region opening the
// WIDGET LIBRARY overlay (availability and budget shown honestly -
// used kinds disabled, never hidden), and SETTINGS pages per page
// (name, rail position/surface, delete with view-restore semantics)
// and per slot (size clamped to legalSizesFor, align, fold priority,
// contract presence lock). The build canvas stays the direct-
// manipulation surface; selection flows both ways through the same
// BuildSelection the canvas always used. All model edits route
// through dev/designer-pages.ts - refusals surface, never vanish.

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Layers, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-preact";

import { curatableNavDefaults } from "../app/App";
import {
  APP_CONTRACT_KINDS,
  APP_WIDGET_KINDS,
  catalogKind,
  type AppWidgetKind,
} from "../app/widget-catalog";
import { usePresentation } from "../runtime/presentation-context";
import type {
  FoldPriority,
  LayoutDocument,
  LayoutPage,
  PageRegionId,
  SlotAlign,
} from "../runtime/layout-document";
import type { UiSize } from "../runtime/stockings";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { useDesignerScope } from "./designer-scope";
import {
  canEditScope,
  mergeScopedLayout,
  resolveScopedLayout,
  scopeBannerText,
  scopedLayoutStored,
} from "./designer-layout-io";
import {
  addPage,
  editablePages,
  insertWidgetAt,
  legalSizesFor,
  removePage,
  removeSlot,
  renamePage,
  setPageRailOpacity,
  setPageRailPosition,
  setSlotAlign,
  setSlotPriority,
  setSlotSize,
  slotAt,
} from "./designer-pages";
import type { BuildSelection } from "./DesignerBuildStage";
import { BackBar, BuilderLibrary, Lbl, Seg } from "./builder-controls";
import { useDeviceSetting } from "./use-device-setting";

/** Default collection view (list/tile) - a DEVICE setting
 *  (ui.collection.view_mode) whose Settings row retired in
 *  consolidation slice 3. It lives with PAGES because it is a page
 *  presentation default; each collection surface keeps its inline
 *  toggle flipping the same setting. */
function CollectionViewControl(): JSX.Element {
  const view = useDeviceSetting<"list" | "tile">(
    "ui.collection.view_mode",
    (v): v is "list" | "tile" => v === "list" || v === "tile",
    "list"
  );
  return (
    <div class="stb-devsetting">
      <Lbl text={t("pages.collectionView")} help={t("pages.collectionViewHelp")} />
      <Seg
        options={["list", "tile"] as const}
        value={view.value}
        label={(v) => t(`pages.view.${v}` as never)}
        onChange={view.set}
      />
      {view.error ? <p class="stb-refusal">{t("viz.saveFailed")}</p> : null}
    </div>
  );
}
import { useStageEditor } from "./stage-editor-state";

const SIZES: readonly UiSize[] = ["atom", "quarter", "third", "half", "two-thirds", "full"];
const ALIGNS: readonly SlotAlign[] = ["auto", "left", "center", "right"];
const REGIONS: readonly PageRegionId[] = ["main", "rail", "deck"];

type PagesView = { mode: "outline" } | { mode: "page"; pageId: string } | { mode: "slot" };

export interface DesignerPagesEditorProps {
  readonly pageId: string | null;
  readonly onPageChange: (pageId: string) => void;
  readonly selection: BuildSelection | null;
  readonly onSelect: (selection: BuildSelection | null) => void;
}

export function DesignerPagesEditor(props: DesignerPagesEditorProps): JSX.Element {
  useLocale();
  const { profileSettings, setProfileSettings, plan } = usePresentation();
  const { scope } = useDesignerScope();
  const stageEd = useStageEditor();
  const [view, setView] = useState<PagesView>({ mode: "outline" });
  const [libFor, setLibFor] = useState<PageRegionId | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalTimer = useRef<number | null>(null);

  const doc = useMemo(
    () => resolveScopedLayout(scope, plan.targetKey, profileSettings),
    [scope, plan.targetKey, profileSettings]
  );
  const pages = editablePages(doc);
  const selected = pages.find((page) => page.id === props.pageId) ?? pages[0] ?? null;

  // Canvas click -> the slot's settings page (two-way selection).
  const selJson = props.selection === null ? "" : JSON.stringify(props.selection);
  useEffect(() => {
    if (selJson !== "") setView({ mode: "slot" });
  }, [selJson]);

  const commit = (next: LayoutDocument) => {
    setProfileSettings(mergeScopedLayout(scope, profileSettings, plan.targetKey, next));
  };
  const showRefusal = (text: string) => {
    setRefusal(text);
    if (refusalTimer.current !== null) window.clearTimeout(refusalTimer.current);
    refusalTimer.current = window.setTimeout(() => setRefusal(null), 3600);
  };

  const hasStored = scopedLayoutStored(scope, plan.targetKey, profileSettings);
  // Destructive: two-step confirm (rev-205 rule).
  const [confirmReset, setConfirmReset] = useState(false);
  const resetScope = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    props.onSelect(null);
    setView({ mode: "outline" });
    setProfileSettings(mergeScopedLayout(scope, profileSettings, plan.targetKey, undefined));
  };

  if (!canEditScope(scope, plan.targetKey)) {
    return (
      <div className="designer-menu" role="group" aria-label="Pages editor">
        <div className="stb-head"><span className="designer-menu-label">{t("pages.title")}</span></div>
        <p className="designer-tab-hint designer-scope-line">
          {scopeBannerText(scope, plan.targetKey)}
        </p>
      </div>
    );
  }

  /* ---------------- settings: one slot ---------------- */
  if (view.mode === "slot" && props.selection !== null && doc !== null) {
    const sel = props.selection;
    const slot = slotAt(doc, sel.pageId, sel.address);
    if (slot === undefined) {
      // Selection went stale (slot removed elsewhere) - back out.
      setView({ mode: "outline" });
      props.onSelect(null);
      return <></>;
    }
    const kind = catalogKind(slot.widgetKindId);
    const contract = APP_CONTRACT_KINDS.has(slot.widgetKindId);
    const lockedRemove = contract && sel.pageId === "home";
    return (
      <div className="designer-menu stb-settings" role="group" aria-label="Widget settings">
        <BackBar title={kind?.label ?? slot.widgetKindId}
          onBack={() => { setView({ mode: "outline" }); props.onSelect(null); }} />
        <p class="stb-help">
          {slot.widgetKindId} - {t(`pages.region.${sel.address.region}` as never)}
        </p>
        <Lbl text={t("pages.size")} help={t("pages.sizeHelp")} />
        <Seg
          options={SIZES}
          value={slot.size}
          label={sizeShort}
          disabled={(size) =>
            kind !== undefined && !legalSizesFor(kind, sel.address.region).includes(size)}
          disabledTitle={() => t("pages.sizeIllegal")}
          onChange={(size) => commit(setSlotSize(doc, sel.pageId, sel.address, size, kind))}
        />
        {sel.address.region === "main" ? (
          <>
            <Lbl text={t("pages.align")}
              help={slot.size === "full" ? t("pages.alignFull") : t("pages.alignHelp")} />
            <Seg
              options={ALIGNS}
              value={slot.align ?? "auto"}
              disabled={() => slot.size === "full"}
              disabledTitle={() => t("pages.alignFull")}
              onChange={(align) => commit(setSlotAlign(doc, sel.pageId, sel.address, align))}
            />
          </>
        ) : null}
        {contract ? (
          <>
            <Lbl text={t("pages.fold")} />
            <p class="stb-help">{t("pages.foldContract")}</p>
          </>
        ) : (
          <>
            <Lbl text={t("pages.fold")} help={t("pages.foldHelp")} />
            <Seg
              options={[1, 2, 3, 4, 5] as readonly FoldPriority[]}
              value={slot.foldPriority}
              onChange={(p) => commit(setSlotPriority(doc, sel.pageId, sel.address, p))}
            />
          </>
        )}
        {slot.widgetKindId === "evo.app.nowplaying" ? (
          <>
            <Lbl text={t("builder.editStage")} help={t("builder.editStageHelp")} />
            <div class="stb-rowline">
              <button type="button"
                onClick={() => { props.onSelect(null); stageEd.enterStage(sel.pageId); }}>
                <LayoutTemplate size={12} /> {t("builder.editStage")}
              </button>
            </div>
          </>
        ) : null}
        {lockedRemove ? (
          <p class="stb-help">{t("pages.presenceLocked")}</p>
        ) : (
          <button type="button" class="stb-danger"
            onClick={() => {
              commit(removeSlot(doc, sel.pageId, sel.address));
              props.onSelect(null);
              setView({ mode: "outline" });
            }}>
            {t("pages.removeWidget")}
          </button>
        )}
      </div>
    );
  }

  /* ---------------- settings: one page ---------------- */
  if (view.mode === "page" && doc !== null) {
    const pid = view.pageId;
    const page = pages.find((p) => p.id === pid);
    if (page === undefined) {
      setView({ mode: "outline" });
      return <></>;
    }
    const rail = page.railPosition ?? "right";
    return (
      <div className="designer-menu stb-settings" role="group" aria-label="Page settings">
        <BackBar title={page.name} onBack={() => setView({ mode: "outline" })} />
        <Lbl text={t("pages.name")} />
        <input
          key={`${page.id}:${page.name}`}
          type="text"
          className="designer-menu-name"
          defaultValue={page.name}
          aria-label={t("pages.name")}
          onChange={(e) => commit(renamePage(doc, page.id, (e.target as HTMLInputElement).value))}
        />
        <Lbl text={t("pages.rail")} help={t("pages.railHelp")} />
        <Seg
          options={["left", "right", "top", "bottom", "off"] as const}
          value={rail}
          onChange={(side) => commit(setPageRailPosition(doc, page.id, side))}
        />
        {rail !== "off" ? (
          <>
            <Lbl text={t("pages.railSurface")} help={t("pages.railSurfaceHelp")} />
            <div class="stb-rowline">
              <input type="range" min={0} max={100} step={5}
                value={Math.round((page.railOpacity ?? 0) * 100)}
                aria-label={t("pages.railSurface")}
                onInput={(e) =>
                  commit(setPageRailOpacity(doc, page.id,
                    Number((e.currentTarget as HTMLInputElement).value) / 100))} />
              <span class="stb-stp-v">{Math.round((page.railOpacity ?? 0) * 100)}%</span>
            </div>
          </>
        ) : null}
        <button type="button" class="stb-danger"
          onClick={() => {
            props.onSelect(null);
            setView({ mode: "outline" });
            commit(removePage(doc, page.id, curatableNavDefaults().some((d) => d.id === page.id)));
          }}>
          {t("pages.deletePage")}
        </button>
        <p class="stb-help">{t("pages.deletePageHelp")}</p>
      </div>
    );
  }

  /* ---------------- outline ---------------- */
  const usedOn = (page: LayoutPage): Set<string> => {
    const used = new Set<string>();
    for (const slots of Object.values(page.regions))
      for (const slot of slots ?? []) used.add(slot.widgetKindId);
    return used;
  };

  return (
    <div className="designer-menu" role="group" aria-label="Pages editor">
      <div className="stb-head">
        <span className="designer-menu-label">{t("pages.title")}</span>
        <span className="stb-state">{String(pages.length)}</span>
        <button type="button"
          onClick={() => {
            const result = addPage(doc, t("pages.newPageName", { n: pages.length + 1 }), curatableNavDefaults());
            props.onPageChange(result.pageId);
            props.onSelect(null);
            commit(result.doc);
          }}>
          <Plus size={12} /> {t("pages.addPage")}
        </button>
        <button type="button" disabled={!hasStored}
          className={confirmReset ? "on" : ""}
          title={scope === "remote" ? t("pages.resetRemoteTitle") : t("pages.resetScreenTitle")}
          onClick={resetScope}>
          <Trash2 size={12} />{" "}
          {confirmReset
            ? t("pages.resetConfirm")
            : scope === "remote" ? t("pages.resetRemote") : t("pages.resetScreen")}
        </button>
      </div>
      <p className="designer-tab-hint">{t("pages.outlineHint")}</p>
      <CollectionViewControl />
      {refusal !== null ? <p class="stb-help stb-refusal">{refusal}</p> : null}

      {pages.length === 0 ? (
        <p className="designer-tab-hint">{t("pages.emptyHint")}</p>
      ) : (
        <div className="stb-outline">
          {pages.map((page) => {
            const active = selected !== null && selected.id === page.id;
            return (
              <div key={page.id} class={"stb-sec" + (active ? " stb-hov" : "")}>
                <div class="stb-sec-head"
                  onClick={() => { props.onPageChange(page.id); props.onSelect(null); }}>
                  <Layers size={12} />
                  <b>{page.name}</b>
                  <span class="stb-acts">
                    <button type="button" title={t("builder.settings")}
                      onClick={(e) => { e.stopPropagation(); setView({ mode: "page", pageId: page.id }); }}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" title={t("pages.deletePage")}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onSelect(null);
                        commit(removePage(doc!, page.id,
                          curatableNavDefaults().some((d) => d.id === page.id)));
                      }}>
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {active ? (
                  <div style={{ padding: "0 8px 8px" }}>
                    {REGIONS.map((region) => {
                      const slots = page.regions[region] ?? [];
                      if (region !== "main" && slots.length === 0 &&
                          (region !== "rail" || (page.railPosition ?? "right") === "off")) {
                        // deck stays listed only when populated; rail
                        // hides its group when the rail is off AND empty
                        if (region === "deck") return null;
                        if (slots.length === 0 && region === "rail") return null;
                      }
                      return (
                        <div key={region}>
                          <div class="stb-region-lbl">{t(`pages.region.${region}` as never)}</div>
                          {slots.map((slot, index) => {
                            const kind = catalogKind(slot.widgetKindId);
                            const isSel = props.selection !== null &&
                              props.selection.pageId === page.id &&
                              props.selection.address.region === region &&
                              props.selection.address.index === index;
                            return (
                              <div key={`${slot.widgetKindId}:${index}`}
                                class={"stb-el" +
                                  (APP_CONTRACT_KINDS.has(slot.widgetKindId) ? " stb-contract" : "") +
                                  (isSel ? " stb-hov" : "")}
                                onClick={() => {
                                  props.onSelect({ pageId: page.id, address: { region, index } });
                                }}>
                                <span>{kind?.label ?? slot.widgetKindId}</span>
                                <span class="stb-badge">{sizeShort(slot.size)}</span>
                                <span class="stb-acts">
                                  {slot.widgetKindId === "evo.app.nowplaying" ? (
                                    <button type="button" title={t("builder.editStage")}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        props.onSelect(null);
                                        stageEd.enterStage(page.id);
                                      }}>
                                      <LayoutTemplate size={12} />
                                    </button>
                                  ) : null}
                                  <button type="button" title={t("builder.settings")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      props.onSelect({ pageId: page.id, address: { region, index } });
                                    }}>
                                    <Pencil size={12} />
                                  </button>
                                  <button type="button"
                                    disabled={APP_CONTRACT_KINDS.has(slot.widgetKindId) && page.id === "home"}
                                    title={APP_CONTRACT_KINDS.has(slot.widgetKindId) && page.id === "home"
                                      ? t("pages.presenceLocked") : t("pages.removeWidget")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      commit(removeSlot(doc!, page.id, { region, index }));
                                      props.onSelect(null);
                                    }}>
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                          <div class="stb-plusrow">
                            <button type="button" class="stb-plus"
                              title={t("pages.lib.title", { region: t(`pages.region.${region}` as never) })}
                              onClick={() => setLibFor(region)}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="designer-tab-hint designer-scope-line">
        {scopeBannerText(scope, plan.targetKey)}
      </p>

      {libFor !== null && selected !== null && doc !== null ? (
        <BuilderLibrary
          title={t("pages.lib.title", { region: t(`pages.region.${libFor}` as never) })}
          groups={[{
            label: t("pages.lib.widgets"),
            items: APP_WIDGET_KINDS.map((kind: AppWidgetKind) => ({
              key: kind.id,
              label: kind.label,
              note: t("pages.envelope", { min: kind.minSize, max: kind.maxSize }),
              marked: APP_CONTRACT_KINDS.has(kind.id),
              disabled: usedOn(selected).has(kind.id),
              disabledTitle: t("pages.lib.used"),
            })),
          }]}
          onPick={(kindId) => {
            const kind = catalogKind(kindId);
            if (kind === undefined) return;
            const result = insertWidgetAt(doc, selected.id, kind, { region: libFor, index: null });
            setLibFor(null);
            if (result.refusal !== null) showRefusal(result.refusal);
            else commit(result.doc);
          }}
          onClose={() => setLibFor(null)}
        />
      ) : null}
    </div>
  );
}

function sizeShort(size: UiSize): string {
  switch (size) {
    case "atom": return "A";
    case "quarter": return "1/4";
    case "third": return "1/3";
    case "half": return "1/2";
    case "two-thirds": return "2/3";
    case "full": return "1/1";
  }
}
