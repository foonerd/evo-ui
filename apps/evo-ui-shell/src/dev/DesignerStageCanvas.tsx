// Stage canvas - the true-aspect glass in the v7 builder chrome.
// Direct manipulation lives HERE: hover outlines, click-to-open the
// node's settings page (in the sidebar outline panel), divider drag
// reweighting with live percentages, and atom drag between cells.
// Verbs and controls live in the sidebar settings pages - the
// floating micro-toolbar chrome is retired (v7 ruling: proper
// builder, library overlay + settings panel).
//
// WYSIWYG: structure nodes render pad / scale / style through the
// SAME stageNodeCss mapper the glass uses. Show mode mounts the real
// StageSurface (live playback) rendering the doc being edited.

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { usePresentation } from "../runtime/presentation-context";
import {
  STAGE_CONTRACT_ATOMS,
  stageNodeCss,
  type StageAtomKind,
  type StageScale,
} from "../runtime/stage-document";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { StageSurface } from "../features/playback/StageSurface";
import { PlayerShellProviders } from "../features/playback/usePlayback";
import { useSpectrum } from "../features/playback/useSpectrum";
import {
  readShowClassicalStrip,
  readVisualizerPrefs,
  readVolumeStep,
} from "../features/playback/local-prefs";
import { readTitleOverflow } from "../features/playback/nowplaying-prefs";
import {
  insertAtomAt,
  moveAtomTo,
  type Sel,
} from "./stage-editor-ops";
import { useStageEditor, withStage } from "./stage-editor-state";

// Re-export for existing imports (state module owns it now).
export { withStage };

type Drag =
  | { from: "lib"; kind: StageAtomKind }
  | { from: "stage"; at: Extract<Sel, { k: "atom" }> };

const selKey = (s: Sel | null): string => (s === null ? "" : JSON.stringify(s));

export function DesignerStageCanvas(): JSX.Element {
  useLocale();
  const ed = useStageEditor();
  const { plan, viewportOverride } = usePresentation();
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [scale, setScale] = useState(1);
  const [livePct, setLivePct] = useState<string | null>(null);
  const [showMode, setShowMode] = useState(false);
  // Transient insertion indicator: which cell, which index. Local
  // UI state only - never touches the document until the drop.
  const [dropAt, setDropAt] = useState<{ key: string; index: number } | null>(null);
  // Wire honesty: no spectrum WS unless previewing AND the visualiser is
  // on - the system switch is on AND the preset is not "off" (same gate
  // the App applies).
  const spectrum = useSpectrum(
    showMode && readVisualizerPrefs().enabled && readVisualizerPrefs().preset !== "off"
  );

  const w = viewportOverride?.widthPx ?? 1280;
  const h = viewportOverride?.heightPx ?? 720;

  useEffect(() => {
    const el = areaRef.current;
    if (el === null) return;
    const fit = () => {
      const availW = Math.max(120, el.clientWidth - 56);
      const availH = Math.max(120, el.clientHeight - 56);
      setScale(Math.min(1, availW / (w + 24), availH / (h + 24)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  const stage = ed.stage;

  /* --------- ordered drops (target validated BEFORE take) --------- */
  /** Insertion index from the pointer: before the first atom whose
   *  line the pointer is above, or whose horizontal midpoint the
   *  pointer has not passed on its own line; else the end. Handles
   *  wrapped cells (line = the atom's own vertical band). */
  const dropIndexFor = (cellEl: HTMLElement, x: number, y: number): number => {
    const atoms = [...cellEl.querySelectorAll(":scope > .stcv-atom")] as HTMLElement[];
    for (let i = 0; i < atoms.length; i++) {
      const r = atoms[i].getBoundingClientRect();
      if (y < r.top) return i;
      if (y <= r.bottom && x < r.left + r.width / 2) return i;
    }
    return atoms.length;
  };
  const dragOverCell = (q: Extract<Sel, { k: "cell" }>) => (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const key = selKey(q);
    const index = dropIndexFor(ev.currentTarget as HTMLElement, ev.clientX, ev.clientY);
    if (dropAt === null || dropAt.key !== key || dropAt.index !== index)
      setDropAt({ key, index });
  };
  const dragLeaveCell = (q: Extract<Sel, { k: "cell" }>) => (ev: DragEvent) => {
    const el = ev.currentTarget as HTMLElement;
    if (ev.relatedTarget instanceof Node && el.contains(ev.relatedTarget)) return;
    if (dropAt !== null && dropAt.key === selKey(q)) setDropAt(null);
  };
  const dropIntoCell = (q: Extract<Sel, { k: "cell" }>) => (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    // Index from the drop's OWN coordinates - never from the caret
    // state, which lags a render behind the pointer.
    const index = dropIndexFor(ev.currentTarget as HTMLElement, ev.clientX, ev.clientY);
    setDropAt(null);
    if (d === null) return;
    ed.mut((secs) => {
      if (d.from === "lib") {
        insertAtomAt(secs, q, d.kind, index);
        return;
      }
      if (!moveAtomTo(secs, d.at, q, index)) return false;
    });
  };

  /* --------- divider drag (weights, live %) --------- */
  const weightDrag = (
    ev: MouseEvent,
    resolve: (secs: unknown) => { weight: number }[],
    i: number,
    horiz: boolean
  ) => {
    ev.preventDefault();
    ev.stopPropagation();
    const start = horiz ? ev.clientX : ev.clientY;
    const span = (horiz ? w : h) * scale;
    const base = JSON.parse(JSON.stringify(stage.sections)) as never;
    const list0 = resolve(base);
    const a0 = list0[i - 1].weight;
    const b0 = list0[i].weight;
    const total = a0 + b0;
    const move = (e: MouseEvent) => {
      const totalW = list0.reduce((n, x) => n + x.weight, 0);
      const delta = (((horiz ? e.clientX : e.clientY) - start) / span) * totalW;
      let na = Math.max(0.25, a0 + delta);
      let nb = Math.max(0.25, b0 - delta);
      const s = (na + nb) / total;
      na /= s; nb /= s;
      ed.mut((secs) => {
        const list = resolve(secs as never);
        list[i - 1].weight = Math.round(na * 4) / 4;
        list[i].weight = Math.round(nb * 4) / 4;
      });
      const tw = totalW;
      setLivePct(`${Math.round((na / tw) * 100)}% | ${Math.round((nb / tw) * 100)}%`);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setLivePct(null);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  /* --------- selection / hover wiring --------- */
  const open = (sel: Sel) => (ev: MouseEvent) => {
    ev.stopPropagation();
    ed.setView({ mode: "set", sel });
  };
  const hoverProps = (sel: Sel) => ({
    onMouseEnter: (e: MouseEvent) => { e.stopPropagation(); ed.setHover(sel); },
    onMouseLeave: () => ed.setHover(null),
  });
  const cls = (base: string, sel: Sel) =>
    base +
    (selKey(ed.hover) === selKey(sel) ? " stcv-hovered" : "") +
    (ed.view.mode === "set" && selKey(ed.view.sel) === selKey(sel) ? " stcv-sel" : "");

  /* ---------------- render ---------------- */
  if (!ed.editable) {
    return (
      <section className="designer-canvas" aria-label="Stage canvas">
        <header className="designer-canvas-head">
          <span className="designer-canvas-label">{t("builder.noScreen")}</span>
        </header>
      </section>
    );
  }
  return (
    <section className="designer-canvas" aria-label="Stage canvas">
      <header className="designer-canvas-head">
        <button type="button" className="stcv-tb-btn"
          title={t("builder.backToPages")}
          onClick={ed.exitStage}>
          &larr; {t("builder.backToPages")}
        </button>
        <span className="designer-canvas-label">
          {ed.stagePageName} / {ed.stored ? t("builder.stageCustom") : t("builder.stageClassic")}
        </span>
        <button type="button" className={"stcv-tb-btn" + (showMode ? " on" : "")}
          title={showMode ? t("builder.designTitle") : t("builder.showTitle")}
          onClick={() => { ed.setView({ mode: "outline" }); setShowMode(!showMode); }}>
          {showMode ? t("builder.design") : t("builder.show")}
        </button>
        {!showMode ? (
          <button type="button" className={"stcv-tb-btn" + (ed.confirmReset ? " on" : "")}
            disabled={!ed.stored}
            title={t("builder.classicTitle")}
            onClick={ed.reset}>
            {ed.confirmReset ? t("builder.classicConfirm") : t("builder.classic")}
          </button>
        ) : null}
      </header>

      <div className="designer-canvas-stage" ref={areaRef}
        onClick={() => ed.setView({ mode: "outline" })}>
        <div className="designer-canvas-glow" aria-hidden />
        <div className="designer-device"
          style={{ width: `${w + 24}px`, height: `${h + 24}px`, transform: `scale(${scale})` }}>
          <div className="designer-device-bezel">
            <div className={"designer-build-panel stcv-panel" + (showMode ? " stcv-panel-live" : "")}
              style={{ width: `${w}px`, height: `${h}px` }}>
              {showMode ? (
                (() => {
                  // Show mode mounts the real StageSurface. That surface
                  // calls usePlayback(), which requires the App-root
                  // PlayerShellProviders tree. The designer is a sibling
                  // of App (DisplayTestLab), so without this wrap the
                  // live glass throws and the panel goes dead black -
                  // Design mode (AtomVisual) is unaffected.
                  const vz = readVisualizerPrefs();
                  return (
                    <PlayerShellProviders>
                      <StageSurface
                        stage={stage}
                        volumeStep={readVolumeStep()}
                        diagnosticsEnabled={false}
                        visualizerEnabled={vz.enabled}
                        visualizerPreset={vz.preset}
                        visualizerBinCount={vz.binCount}
                        visualizerChannelMode={vz.channelMode}
                        visualizerSensitivityDb={vz.sensitivityDb}
                        visualizerDecay={vz.decay}
                        visualizerOnSelectPreset={() => {}}
                        visualizerOnSelectPalette={() => {}}
                        visualizerPalette={vz.palette}
                        visualizerColorMode={vz.colorMode}
                        spectrumFrame={spectrum.frameRef}
                        showClassicalStrip={readShowClassicalStrip()}
                        titleOverflowMode={readTitleOverflow()}
                      />
                    </PlayerShellProviders>
                  );
                })()
              ) : stage.sections.map((section, s) => (
                <>
                  {s > 0 ? (
                    <div key={`hd${s}`} class="stcv-hdivider"
                      onMouseDown={(ev) => weightDrag(ev as unknown as MouseEvent,
                        (m) => m as unknown as { weight: number }[], s, false)} />
                  ) : null}
                  <div key={`s${s}`}
                    class={cls("stcv-sec", { k: "sec", s })}
                    style={{ flexGrow: section.weight, ...stageNodeCss(section) }}
                    data-sel={selKey({ k: "sec", s })}
                    {...hoverProps({ k: "sec", s })}
                    onClick={open({ k: "sec", s })}>
                    {section.cols.map((column, c) => (
                      <>
                        {c > 0 ? (
                          <div key={`vd${s}.${c}`} class="stcv-vdivider"
                            onMouseDown={(ev) => weightDrag(ev as unknown as MouseEvent,
                              (m) => (m as never as { cols: { weight: number }[] }[])[s].cols, c, true)} />
                        ) : null}
                        <div key={`c${s}.${c}`}
                          class={cls("stcv-col", { k: "col", s, c })}
                          style={{ flexGrow: column.weight, flexBasis: 0, ...stageNodeCss(column) }}
                          data-sel={selKey({ k: "col", s, c })}
                          {...hoverProps({ k: "col", s, c })}
                          onClick={open({ k: "col", s, c })}>
                          {column.rows.map((rw, r) => (
                            <div key={`r${r}`}
                              class={cls("stcv-row", { k: "row", s, c, r })}
                              style={{ flexGrow: rw.weight, ...stageNodeCss(rw) }}
                              data-sel={selKey({ k: "row", s, c, r })}
                              {...hoverProps({ k: "row", s, c, r })}
                              onClick={open({ k: "row", s, c, r })}>
                              {rw.cells.map((cl, l) => (
                                <>
                                  {l > 0 ? (
                                    <div key={`cd${l}`} class="stcv-vdivider"
                                      onMouseDown={(ev) => weightDrag(ev as unknown as MouseEvent,
                                        (m) => (m as never as { cols: { rows: { cells: { weight: number }[] }[] }[] }[])[s].cols[c].rows[r].cells, l, true)} />
                                  ) : null}
                                  <div key={`l${l}`}
                                    class={cls("stcv-cell", { k: "cell", s, c, r, l })}
                                    style={{
                                      flexGrow: cl.weight, flexBasis: 0,
                                      justifyContent: { left: "flex-start", center: "center", right: "flex-end", justify: "space-between" }[cl.ha ?? "center"],
                                      alignItems: { top: "flex-start", center: "center", bottom: "flex-end" }[cl.va ?? "center"],
                                      ...stageNodeCss(cl),
                                    }}
                                    data-sel={selKey({ k: "cell", s, c, r, l })}
                                    {...hoverProps({ k: "cell", s, c, r, l })}
                                    onClick={open({ k: "cell", s, c, r, l })}
                                    onDragOver={dragOverCell({ k: "cell", s, c, r, l })}
                                    onDragLeave={dragLeaveCell({ k: "cell", s, c, r, l })}
                                    onDrop={dropIntoCell({ k: "cell", s, c, r, l })}>
                                    {cl.atoms.map((b, a) => (
                                      <>
                                        {dropAt !== null &&
                                         dropAt.key === selKey({ k: "cell", s, c, r, l }) &&
                                         dropAt.index === a ? (
                                          <span key={`ci${a}`} class="stcv-caret" aria-hidden />
                                        ) : null}
                                        <div key={`a${a}`}
                                          class={cls("stcv-atom", { k: "atom", s, c, r, l, a })}
                                          data-sel={selKey({ k: "atom", s, c, r, l, a })}
                                          draggable
                                          onDragStart={(ev) => {
                                            (ev as unknown as DragEvent).stopPropagation?.();
                                            dragRef.current = { from: "stage", at: { k: "atom", s, c, r, l, a } };
                                          }}
                                          onDragEnd={() => setDropAt(null)}
                                          {...hoverProps({ k: "atom", s, c, r, l, a })}
                                          onClick={open({ k: "atom", s, c, r, l, a })}>
                                          <AtomVisual kind={b.kind} scale={b.scale ?? 2} />
                                        </div>
                                      </>
                                    ))}
                                    {dropAt !== null &&
                                     dropAt.key === selKey({ k: "cell", s, c, r, l }) &&
                                     dropAt.index >= cl.atoms.length ? (
                                      <span class="stcv-caret" aria-hidden />
                                    ) : null}
                                  </div>
                                </>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    ))}
                  </div>
                </>
              ))}
            </div>
          </div>
        </div>
        {livePct !== null ? <span class="stcv-live">{livePct}</span> : null}
      </div>
    </section>
  );
}

/* WYSIWYG bodies with demo content for design mode (Show mode mounts
 * the real surface). */
function AtomVisual({ kind, scale }: { kind: StageAtomKind; scale: StageScale }): JSX.Element {
  const s = ` stage-vz-s${scale}`;
  switch (kind) {
    case "title": return <span class={"stage-vz-title" + s}>Song of Durin</span>;
    case "artist": return <span class={"stage-vz-artist" + s}>Peter Hollens</span>;
    case "album": return <span class={"stage-vz-album" + s}>Misty Mountains / (2016)</span>;
    case "classical": return <span class={"stage-vz-album" + s}>WORK - Symphony No. 9</span>;
    case "art": return <span class={"stage-vz-art" + s} />;
    case "viz": return (
      <span class={"stage-vz-viz" + s}>
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ height: `${25 + ((i * 37) % 70)}%`, animationDelay: `${(i * 67) % 500}ms` }} />
        ))}
      </span>
    );
    case "progress": return (
      <span class={"stage-vz-bar" + s}><em>1:09</em><i><b style={{ width: "43%" }} /></i><em>2:40</em></span>
    );
    case "volume": return (
      <span class={"stage-vz-bar" + s}><em>&#128266;</em><i><b style={{ width: "51%" }} /></i><em>51%</em></span>
    );
    case "play": return <span class={"stage-vz-btn stage-vz-btn-main" + s}>&#10073;&#10073;</span>;
    case "prev": return <span class={"stage-vz-btn" + s}>&#9198;</span>;
    case "next": return <span class={"stage-vz-btn" + s}>&#9197;</span>;
    case "shuffle": return <span class={"stage-vz-btn" + s}>&#8646;</span>;
    case "repeat1": return <span class={"stage-vz-btn" + s}>&#8635;&sup1;</span>;
    case "repeatAll": return <span class={"stage-vz-btn" + s}>&#8635;</span>;
    case "fav": return <span class={"stage-vz-fav" + s}>&#9825;</span>;
    case "codec": return <span class={"stage-vz-sticker" + s}>FLAC</span>;
    case "bitrate": return <span class={"stage-vz-sticker" + s}>320 kbps</span>;
    case "nav": return <span class={"stage-vz-btn" + s}>&#9776;</span>;
    case "spacer": return <span class={"stage-vz-spacer" + s} title={atomTitle("spacer")} />;
    case "bio": return <span class={"stage-vz-artist" + s}>Artist bio - Wikipedia</span>;
    case "notes": return <span class={"stage-vz-album" + s}>Album notes - Discogs</span>;
    case "lyrics": return <span class={"stage-vz-album" + s}>Lyrics - LRCLIB</span>;
    case "provenance": return <span class={"stage-vz-sticker" + s}>Studio - 2016</span>;
    case "smart": return <span class={"stage-vz-album" + s}>Smart metadata crawl</span>;
    case "tabbed": return <span class={"stage-vz-album" + s}>Track info (tabs)</span>;
  }
}
function atomTitle(k: StageAtomKind): string {
  return t(`atom.${k}` as never);
}
