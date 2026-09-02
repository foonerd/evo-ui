// Stage builder sidebar - the YooTheme-pattern chrome ruled in on the
// v7 mockup: an outline of cards (sections > columns > rows > cells >
// element chips) with hover actions, "+" buttons opening the element
// LIBRARY overlay, and a per-node SETTINGS page (back arrow, labeled
// control groups, help text) replacing the floating micro-toolbar.
// All mutations route through the shared editor context (one write
// path with the canvas); every string through the i18n catalog.

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AudioLines,
  BookOpen,
  Copy,
  Disc3,
  FileText,
  Gauge,
  LayoutList,
  Quote,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Heart,
  Image,
  Menu,
  Music,
  Pencil,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  StretchHorizontal,
  Trash2,
  Type,
  Volume2,
} from "lucide-preact";

import { BackBar, BuilderLibrary, Lbl, Seg, Stepper } from "./builder-controls";
import { useDeviceSetting } from "./use-device-setting";

/** Classical metadata strip policy - a DEVICE setting since
 *  consolidation slice 3 (ui.classical.metadata_mode; was a
 *  per-browser Settings row). It lives with the STAGE because the
 *  strip is stage content: Auto/On follow the track's classical
 *  tags, Off suppresses the strip on every surface. */
function ClassicalStripControl(): JSX.Element {
  const mode = useDeviceSetting<"auto" | "on" | "off">(
    "ui.classical.metadata_mode",
    (v): v is "auto" | "on" | "off" => v === "auto" || v === "on" || v === "off",
    "auto"
  );
  return (
    <div class="stb-devsetting">
      <Lbl text={t("builder.classical")} help={t("builder.classicalHelp")} />
      <Seg
        options={["auto", "on", "off"] as const}
        value={mode.value}
        label={(v) => t(`settings.mode.${v}` as never)}
        onChange={mode.set}
      />
      {mode.error ? <p class="stb-refusal">{t("viz.saveFailed")}</p> : null}
    </div>
  );
}

import {
  STAGE_CONTRACT_ATOMS,
  type StageAtomKind,
  type StageCell,
  type StageColumn,
  type StageHAlign,
  type StagePad,
  type StageRow,
  type StageSection,
  type StageStyle,
  type StageVAlign,
} from "../runtime/stage-document";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { usePresentation } from "../runtime/presentation-context";
import { useDesignerScope } from "./designer-scope";
import { scopeBannerText } from "./designer-layout-io";
import {
  addCell,
  addRow,
  addSectionAfter,
  duplicateAt,
  insertAtom,
  nodeAt,
  nudgeAtom,
  removeAt,
  splitCell,
  splitSection,
  SPLIT_PRESETS,
  type MBlock,
  type MCell,
  type MCol,
  type MRow,
  type MSec,
  type Sel,
} from "./stage-editor-ops";
import { useStageEditor } from "./stage-editor-state";

const ATOM_ICON: Record<StageAtomKind, typeof Image> = {
  art: Image, title: Type, artist: Music, album: Disc3, classical: BookOpen,
  viz: AudioLines, progress: Gauge, play: Play, prev: SkipBack, next: SkipForward,
  shuffle: Shuffle, repeat1: Repeat1, repeatAll: Repeat, fav: Heart,
  volume: Volume2, codec: Activity, bitrate: Activity, nav: Menu,
  spacer: StretchHorizontal,
  bio: FileText, notes: ScrollText, lyrics: Quote, provenance: ShieldCheck,
  smart: Sparkles, tabbed: LayoutList,
};
const atomName = (k: StageAtomKind): string => t(`atom.${k}` as never);

const LIB_GROUPS: readonly [string, readonly StageAtomKind[]][] = [
  ["builder.lib.metadata", ["title", "artist", "album", "classical", "art", "codec", "bitrate", "bio", "notes", "lyrics", "provenance", "smart", "tabbed"]],
  ["builder.lib.playback", ["play", "prev", "next", "shuffle", "repeat1", "repeatAll", "fav", "progress", "volume"]],
  ["builder.lib.ambient", ["viz", "nav", "spacer"]],
];

const selKey = (s: Sel | null): string => (s === null ? "" : JSON.stringify(s));

/* ------------------------- hover actions ------------------------- */

function Acts(props: { sel: Sel; lockedDelete: boolean }): JSX.Element {
  const ed = useStageEditor();
  return (
    <span class="stb-acts">
      <button type="button" title={t("builder.settings")}
        onClick={(e) => { e.stopPropagation(); ed.setView({ mode: "set", sel: props.sel }); }}>
        <Pencil size={12} />
      </button>
      <button type="button" title={t("builder.duplicate")}
        onClick={(e) => { e.stopPropagation(); ed.mut((m) => duplicateAt(m, props.sel)); }}>
        <Copy size={12} />
      </button>
      <button type="button" disabled={props.lockedDelete}
        title={props.lockedDelete ? t("builder.presenceLocked") : t("builder.delete")}
        onClick={(e) => {
          e.stopPropagation();
          ed.mut((m) => (removeAt(m, props.sel) ? undefined : false));
          if (selKey(ed.view.mode === "set" ? ed.view.sel : null) === selKey(props.sel))
            ed.setView({ mode: "outline" });
        }}>
        <Trash2 size={12} />
      </button>
    </span>
  );
}

/* ------------------------- outline ------------------------- */

function Outline(): JSX.Element {
  const ed = useStageEditor();
  const counts: Partial<Record<StageAtomKind, number>> = {};
  ed.stage.sections.forEach((s) => s.cols.forEach((c) => c.rows.forEach((r) =>
    r.cells.forEach((l) => l.atoms.forEach((b) => { counts[b.kind] = (counts[b.kind] ?? 0) + 1; })))));
  const lastContract = (k: StageAtomKind) =>
    STAGE_CONTRACT_ATOMS.has(k) && (counts[k] ?? 0) <= 1;

  const hoverProps = (sel: Sel) => ({
    onMouseEnter: (e: MouseEvent) => { e.stopPropagation(); ed.setHover(sel); },
    onMouseLeave: () => ed.setHover(null),
  });
  const hovCls = (sel: Sel) => (selKey(ed.hover) === selKey(sel) ? " stb-hov" : "");

  return (
    <div class="stb-outline">
      <p class="designer-tab-hint">{t("builder.outlineHint")}</p>
      <ClassicalStripControl />
      {ed.stage.sections.map((sec, s) => {
        const secSel: Sel = { k: "sec", s };
        return (
          <>
            <div key={`s${s}`} class={"stb-sec" + hovCls(secSel)} data-osel={selKey(secSel)}>
              <div class="stb-sec-head" {...hoverProps(secSel)}
                onClick={() => ed.setView({ mode: "set", sel: secSel })}>
                <b>{t("builder.section")} {s + 1}</b>
                <span class="stb-mods">{mods(sec)}</span>
                <Acts sel={secSel}
                  lockedDelete={sec.cols.some((c) => c.rows.some((r) => r.cells.some((l) =>
                    l.atoms.some((b) => lastContract(b.kind)))))} />
              </div>
              <div class="stb-cols">
                {sec.cols.map((col, c) => {
                  const colSel: Sel = { k: "col", s, c };
                  return (
                    <div key={`c${c}`} class={"stb-col" + hovCls(colSel)} {...hoverProps(colSel)}
                      onClick={(e) => { e.stopPropagation(); ed.setView({ mode: "set", sel: colSel }); }}>
                      {col.rows.map((row, r) => {
                        const rowSel: Sel = { k: "row", s, c, r };
                        return (
                          <div key={`r${r}`} class={"stb-row" + hovCls(rowSel)} {...hoverProps(rowSel)}
                            onClick={(e) => { e.stopPropagation(); ed.setView({ mode: "set", sel: rowSel }); }}>
                            {row.cells.map((cl, l) => {
                              const cellSel: Sel & { k: "cell" } = { k: "cell", s, c, r, l };
                              return (
                                <div key={`l${l}`} class={"stb-cellcard" + hovCls(cellSel)} {...hoverProps(cellSel)}
                                  onClick={(e) => { e.stopPropagation(); ed.setView({ mode: "set", sel: cellSel }); }}>
                                  <div class="stb-cell-head">
                                    <span>{t("builder.cell").toLowerCase()} {cl.ha ?? "center"}/{cl.va ?? "center"} {mods(cl)}</span>
                                    <Acts sel={cellSel}
                                      lockedDelete={cl.atoms.some((b) => lastContract(b.kind))} />
                                  </div>
                                  {cl.atoms.map((b, a) => {
                                    const atomSel: Sel = { k: "atom", s, c, r, l, a };
                                    const Icon = ATOM_ICON[b.kind];
                                    return (
                                      <div key={`a${a}`}
                                        class={"stb-el" + (STAGE_CONTRACT_ATOMS.has(b.kind) ? " stb-contract" : "") + hovCls(atomSel)}
                                        {...hoverProps(atomSel)}
                                        onClick={(e) => { e.stopPropagation(); ed.setView({ mode: "set", sel: atomSel }); }}>
                                        <Icon size={13} />
                                        <span>{atomName(b.kind)}{b.scale !== undefined && b.scale !== 2 ? ` (${["S", "M", "L"][b.scale - 1]})` : ""}</span>
                                        <Acts sel={atomSel} lockedDelete={lastContract(b.kind)} />
                                      </div>
                                    );
                                  })}
                                  <div class="stb-plusrow">
                                    <button type="button" class="stb-plus" title={t("builder.addElement")}
                                      onClick={(e) => { e.stopPropagation(); ed.setLibFor(cellSel); }}>+</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div key={`sp${s}`} class="stb-secplus">
              <button type="button" class="stb-plus" title={t("builder.addSection")}
                onClick={() => ed.mut((m) => addSectionAfter(m, s))}>+</button>
            </div>
          </>
        );
      })}
    </div>
  );
}

/** Compact non-default annotation: p2 / p[1.0.0.2] / 120% / st */
function mods(n: { pad?: StagePad; scale?: number; style?: StageStyle }): string {
  const out: string[] = [];
  if (n.pad !== undefined)
    out.push(typeof n.pad === "number" ? `p${n.pad}` : `p[${n.pad.t}.${n.pad.r}.${n.pad.b}.${n.pad.l}]`);
  if (n.scale !== undefined) out.push(`${n.scale}%`);
  if (n.style !== undefined) out.push("st");
  return out.join(" ");
}

/* ------------------------- settings page ------------------------- */

function PadEditor(props: { node: { pad?: StagePad }; sel: Sel }): JSX.Element {
  const ed = useStageEditor();
  const pad = props.node.pad ?? 0;
  const linked = typeof pad === "number";
  const setPad = (v: StagePad) =>
    ed.mut((m) => { (nodeAt(m, props.sel) as MCell).pad = v; });
  return (
    <>
      <Lbl text={t("builder.set.padding")} help={t("builder.set.paddingHelp")} />
      <div class="stb-rowline">
        <button type="button" class={linked ? "on" : ""}
          title={linked ? t("builder.set.linkedTitle") : t("builder.set.perSideTitle")}
          onClick={() =>
            setPad(linked ? { t: pad, r: pad, b: pad, l: pad } : (pad as Exclude<StagePad, number>).t)}>
          {linked ? t("builder.set.linked") : t("builder.set.perSide")}
        </button>
        {linked ? (
          <Stepper value={pad} min={0} max={8} step={1} onChange={(v) => setPad(v)} />
        ) : null}
      </div>
      {!linked
        ? (["t", "r", "b", "l"] as const).map((side) => (
            <div key={side} class="stb-rowline">
              <span class="stb-help stb-sidename">
                {t(`builder.set.${{ t: "top", r: "right", b: "bottom", l: "left" }[side]}` as never)}
              </span>
              <Stepper value={(pad as Exclude<StagePad, number>)[side]} min={0} max={8} step={1}
                onChange={(v) => setPad({ ...(pad as Exclude<StagePad, number>), [side]: v })} />
            </div>
          ))
        : null}
    </>
  );
}

function NodeControls(props: {
  node: { pad?: StagePad; scale?: number; style?: StageStyle }; sel: Sel;
}): JSX.Element {
  const ed = useStageEditor();
  const st = props.node.style ?? {};
  const setStyle = (patch: { bg?: string; bd?: string; rad?: number; op?: number }) =>
    ed.mut((m) => {
      const n = nodeAt(m, props.sel) as MCell;
      const next: Record<string, unknown> = { ...(n.style ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === "none" || v === 0 || v === 100) delete next[k];
        else next[k] = v;
      }
      if (Object.keys(next).length === 0) delete n.style;
      else n.style = next as StageStyle;
    });
  return (
    <>
      <PadEditor node={props.node} sel={props.sel} />
      <Lbl text={t("builder.set.scale")} help={t("builder.set.scaleHelp")} />
      <Stepper value={props.node.scale ?? 100} min={50} max={200} step={10}
        fmt={(v) => `${v}%`}
        onChange={(v) => ed.mut((m) => {
          const n = nodeAt(m, props.sel) as MCell;
          if (v === 100) delete n.scale; else n.scale = v;
        })} />
      <Lbl text={t("builder.set.background")} help={t("builder.set.backgroundHelp")} />
      <Seg options={["none", "panel", "card", "tint"] as const}
        value={st.bg ?? "none"} label={(v) => t(`builder.opt.${v}` as never)}
        onChange={(v) => setStyle({ bg: v })} />
      <Lbl text={t("builder.set.border")} />
      <Seg options={["none", "hairline", "accent"] as const}
        value={st.bd ?? "none"} label={(v) => t(`builder.opt.${v}` as never)}
        onChange={(v) => setStyle({ bd: v })} />
      <Lbl text={t("builder.set.radius")} />
      <Seg options={[0, 1, 2, 3] as const} value={st.rad ?? 0}
        onChange={(v) => setStyle({ rad: v })} />
      <Lbl text={t("builder.set.opacity")} />
      <Seg options={[100, 85, 70, 50] as const} value={st.op ?? 100}
        label={(v) => `${v}%`}
        onChange={(v) => setStyle({ op: v })} />
    </>
  );
}

function SplitPicker(props: { onPick: (ws: number[]) => void }): JSX.Element {
  const [custom, setCustom] = useState("");
  return (
    <>
      <div class="stb-splits">
        {SPLIT_PRESETS.map((ws, i) => (
          <button key={i} type="button" class="stb-split" title={ws.join("+")}
            onClick={() => props.onPick([...ws])}>
            {ws.map((w, j) => <i key={j} style={{ flexGrow: w }} />)}
          </button>
        ))}
      </div>
      <div class="stb-rowline">
        <input type="text" value={custom} placeholder={t("builder.set.customSplit")}
          onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)} />
        <button type="button" onClick={() => {
          const ws = (custom.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0).slice(0, 8);
          if (ws.length >= 2) props.onPick(ws);
        }}>{t("builder.set.apply")}</button>
      </div>
    </>
  );
}

function SettingsPage(props: { sel: Sel }): JSX.Element {
  const ed = useStageEditor();
  const { sel } = props;
  const secs = ed.stage.sections;
  const node = nodeAt(secs as unknown as MSec[], sel);
  if (node === undefined) {
    ed.setView({ mode: "outline" });
    return <></>;
  }
  const name =
    sel.k === "atom" ? atomName((node as MBlock).kind)
    : sel.k === "sec" ? t("builder.section")
    : sel.k === "col" ? t("builder.column")
    : sel.k === "row" ? t("builder.row")
    : t("builder.cell");
  const setWeight = (v: number) => ed.mut((m) => { (nodeAt(m, sel) as MSec).weight = v; });

  const lockedDelete =
    sel.k === "atom"
      ? STAGE_CONTRACT_ATOMS.has((node as MBlock).kind) &&
        (() => {
          let n = 0;
          secs.forEach((s) => s.cols.forEach((c) => c.rows.forEach((r) =>
            r.cells.forEach((l) => l.atoms.forEach((b) => { if (b.kind === (node as MBlock).kind) n++; })))));
          return n <= 1;
        })()
      : false;

  return (
    <div class="stb-settings">
      <BackBar title={name} onBack={() => ed.setView({ mode: "outline" })} />

      {sel.k === "sec" ? (
        <>
          <Lbl text={t("builder.set.structure")} help={t("builder.set.structureHelp")} />
          <SplitPicker onPick={(ws) => ed.mut((m) => splitSection(m, sel.s, ws))} />
          <Lbl text={t("builder.set.heightWeight")} help={t("builder.set.heightWeightHelp")} />
          <Stepper value={(node as StageSection).weight} min={0.25} max={24} step={0.25} onChange={setWeight} />
          <Lbl text={t("builder.set.foldPriority")} help={t("builder.set.foldPriorityHelp")} />
          <Seg options={[1, 2, 3, 4, 5] as const} value={(node as StageSection).foldPriority}
            onChange={(v) => ed.mut((m) => { (nodeAt(m, sel) as MSec).foldPriority = v; })} />
        </>
      ) : null}

      {sel.k === "col" ? (
        <>
          <Lbl text={t("builder.set.widthWeight")} help={t("builder.set.colWidthHelp")} />
          <Stepper value={(node as StageColumn).weight} min={0.25} max={24} step={0.25} onChange={setWeight} />
          <div class="stb-rowline">
            <button type="button" onClick={() => ed.mut((m) => addRow(m, sel.s, sel.c))}>
              + {t("builder.addRow")}
            </button>
          </div>
        </>
      ) : null}

      {sel.k === "row" ? (
        <>
          <Lbl text={t("builder.set.heightWeight")} help={t("builder.set.rowHeightHelp")} />
          <Stepper value={(node as StageRow).weight} min={0.25} max={24} step={0.25} onChange={setWeight} />
          <div class="stb-rowline">
            <button type="button" onClick={() => ed.mut((m) => addCell(m, sel.s, sel.c, sel.r))}>
              + {t("builder.addCell")}
            </button>
          </div>
        </>
      ) : null}

      {sel.k === "cell" ? (
        <>
          <Lbl text={t("builder.set.structure")} help={t("builder.set.structureHelp")} />
          <SplitPicker onPick={(ws) => ed.mut((m) => splitCell(m, sel, ws))} />
          <Lbl text={t("builder.set.widthWeight")} help={t("builder.set.cellWidthHelp")} />
          <Stepper value={(node as StageCell).weight} min={0.25} max={24} step={0.25} onChange={setWeight} />
          <Lbl text={t("builder.set.alignment")} help={t("builder.set.alignmentHelp")} />
          <Seg options={["left", "center", "right", "justify"] as const}
            value={(node as StageCell).ha ?? "center"}
            label={(v) => t(`builder.align.${v}` as never)}
            onChange={(v) => ed.mut((m) => { (nodeAt(m, sel) as MCell).ha = v as StageHAlign; })} />
          <div style={{ height: "6px" }} />
          <Seg options={["top", "center", "bottom"] as const}
            value={(node as StageCell).va ?? "center"}
            label={(v) => t(`builder.align.${v}` as never)}
            onChange={(v) => ed.mut((m) => { (nodeAt(m, sel) as MCell).va = v as StageVAlign; })} />
          <Lbl text={t("builder.set.elements")} help={t("builder.set.elementsHelp")} />
          {(node as StageCell).atoms.map((b, a, all) => {
            const Icon = ATOM_ICON[b.kind];
            const atomSel: Sel & { k: "atom" } = { ...sel, k: "atom", a };
            return (
              <div key={a} class={"stb-el" + (STAGE_CONTRACT_ATOMS.has(b.kind) ? " stb-contract" : "")}
                onClick={() => ed.setView({ mode: "set", sel: atomSel })}>
                <Icon size={13} /><span>{atomName(b.kind)}</span>
                <span class="stb-acts">
                  <button type="button" title={t("builder.moveUp")} disabled={a === 0}
                    onClick={(e) => { e.stopPropagation(); ed.mut((m) => (nudgeAtom(m, atomSel, -1) ? undefined : false)); }}>
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" title={t("builder.moveDown")} disabled={a === all.length - 1}
                    onClick={(e) => { e.stopPropagation(); ed.mut((m) => (nudgeAtom(m, atomSel, 1) ? undefined : false)); }}>
                    <ArrowDown size={12} />
                  </button>
                </span>
                <Acts sel={atomSel} lockedDelete={false} />
              </div>
            );
          })}
          <div class="stb-rowline">
            <button type="button" onClick={() => ed.setLibFor(sel)}>+ {t("builder.addElement")}</button>
          </div>
        </>
      ) : null}

      {sel.k === "atom" ? (
        <>
          <Lbl text={t("builder.set.sizeStep")} help={t("builder.set.sizeStepHelp")} />
          <Seg options={[1, 2, 3] as const} value={(node as MBlock).scale ?? 2}
            label={(v) => ["S", "M", "L"][v - 1]}
            onChange={(v) => ed.mut((m) => {
              const b = nodeAt(m, sel) as MBlock;
              if (v === 2) delete b.scale; else b.scale = v as MBlock["scale"];
            })} />
          {STAGE_CONTRACT_ATOMS.has((node as MBlock).kind) ? (
            <p class="stb-help">{t("builder.contractNote")}</p>
          ) : null}
        </>
      ) : null}

      {sel.k !== "atom" ? <NodeControls node={node as StageSection} sel={sel} /> : null}

      <button type="button" class="stb-danger" disabled={lockedDelete}
        title={lockedDelete ? t("builder.presenceLocked") : undefined}
        onClick={() => {
          ed.mut((m) => (removeAt(m, sel) ? undefined : false));
          ed.setView({ mode: "outline" });
        }}>
        {t("builder.deleteNode", { name: name.toLowerCase() })}
      </button>
    </div>
  );
}

/* ------------------------- element library ------------------------- */

function Library(): JSX.Element | null {
  const ed = useStageEditor();
  if (ed.libFor === null) return null;
  const target = ed.libFor;
  return (
    <BuilderLibrary
      title={t("builder.lib.title", { n: Object.keys(ATOM_ICON).length })}
      groups={LIB_GROUPS.map(([group, kinds]) => ({
        label: t(group as never),
        items: kinds.map((k) => {
          const Icon = ATOM_ICON[k];
          return {
            key: k,
            label: atomName(k),
            icon: <Icon size={20} />,
            marked: STAGE_CONTRACT_ATOMS.has(k),
          };
        }),
      }))}
      onPick={(k) => {
        ed.mut((m) => insertAtom(m, target, k as StageAtomKind));
        ed.setLibFor(null);
      }}
      onClose={() => ed.setLibFor(null)}
    />
  );
}

/* ------------------------- panel root ------------------------- */

export function DesignerStageOutline(): JSX.Element {
  useLocale();
  const ed = useStageEditor();
  const { plan } = usePresentation();
  const { scope } = useDesignerScope();
  if (!ed.editable) {
    return (
      <p class="designer-tab-hint designer-scope-line">
        {scopeBannerText(scope, plan.targetKey)}
      </p>
    );
  }
  return (
    <>
      {ed.view.mode === "outline" ? <Outline /> : <SettingsPage sel={ed.view.sel} />}
      <Library />
    </>
  );
}
