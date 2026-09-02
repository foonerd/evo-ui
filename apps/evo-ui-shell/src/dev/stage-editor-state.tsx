// Shared state for the stage builder's TWO chromes - the sidebar
// outline/settings panel and the true-aspect canvas. One selection,
// one hover, one document write path; the panels can never diverge
// (label/control parity applied to editor state).

import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";

import { usePresentation } from "../runtime/presentation-context";
import type { LayoutDocument } from "../runtime/layout-document";
import { CLASSIC_STAGE, type StageDoc } from "../runtime/stage-document";
import { useDesignerScope } from "./designer-scope";
import {
  canEditScope,
  mergeScopedLayout,
  resolveScopedLayout,
} from "./designer-layout-io";
import { synthesizeHomePage } from "./designer-pages";
import { cloneSections, pruneEmpty, type MSec, type Sel } from "./stage-editor-ops";

/** Attach/detach a stage document on a page of a layout doc.
 *  `stage === undefined` is the reset - the page drops its stage and
 *  the glass falls back to the shipped classic arrangement. The home
 *  page synthesizes copy-on-write; other pages must already exist. */
export function withStage(
  doc: LayoutDocument | null,
  stage: StageDoc | undefined,
  pageId = "home"
): LayoutDocument {
  const base = pageId === "home" ? synthesizeHomePage(doc).doc : doc;
  if (base === null) return synthesizeHomePage(null).doc;
  return {
    ...base,
    pages: base.pages.map((p) => {
      if (p.id !== pageId) return p;
      if (stage === undefined) {
        const { stage: _drop, ...rest } = p;
        return rest;
      }
      return { ...p, stage };
    }),
  };
}

export type StageView = { mode: "outline" } | { mode: "set"; sel: Sel };

export interface StageEditorApi {
  /** The doc being edited (stored custom or the classic default). */
  readonly stage: StageDoc;
  /** True when a custom stage is stored (reset would change things). */
  readonly stored: boolean;
  /** False = no storage destination (no screen selected). */
  readonly editable: boolean;
  /** Drill-in state (one-canvas ruling): the page whose stage is
   *  being edited, or null when not drilled in. */
  readonly stagePageId: string | null;
  /** Display name of the drilled page (breadcrumb). */
  readonly stagePageName: string;
  enterStage(pageId: string): void;
  exitStage(): void;
  readonly view: StageView;
  setView(v: StageView): void;
  readonly hover: Sel | null;
  setHover(sel: Sel | null): void;
  /** Cell awaiting an element from the library overlay. */
  readonly libFor: Extract<Sel, { k: "cell" }> | null;
  setLibFor(sel: Extract<Sel, { k: "cell" }> | null): void;
  /** Mutate-and-commit: fn edits the mutable mirror; return false to
   *  abort without committing (e.g. a refused delete). */
  mut(fn: (secs: MSec[]) => void | false): void;
  /** Two-step classic reset (rev-205 rule). */
  reset(): void;
  readonly confirmReset: boolean;
}

const Ctx = createContext<StageEditorApi | null>(null);

export function useStageEditor(): StageEditorApi {
  const api = useContext(Ctx);
  if (api === null) throw new Error("useStageEditor outside StageEditorProvider");
  return api;
}

export function StageEditorProvider(props: { children: ComponentChildren }): JSX.Element {
  const { profileSettings, setProfileSettings, plan } = usePresentation();
  const { scope } = useDesignerScope();
  const [view, setView] = useState<StageView>({ mode: "outline" });
  const [hover, setHover] = useState<Sel | null>(null);
  const [libFor, setLibFor] = useState<Extract<Sel, { k: "cell" }> | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [drilled, setDrilled] = useState<string | null>(null);

  const doc = resolveScopedLayout(scope, plan.targetKey, profileSettings);
  // Exit automatically when the drilled page vanished (deleted, scope
  // or target switch) - a stale drill must never edit the wrong page.
  const drilledPage = (() => {
    if (drilled === null) return null;
    const p = doc?.pages.find((x) => x.id === drilled);
    if (p !== undefined) return { id: p.id, name: p.name, stage: p.stage };
    // Home exists even when nothing is stored (copy-on-write default).
    if (drilled === "home") return { id: "home", name: "Home", stage: undefined };
    return null; // page deleted under us - auto-exit
  })();
  const stagePageId = drilledPage?.id ?? null;
  const stagePageName = drilledPage?.name ?? "Home";
  const storedStage = drilledPage?.stage ?? null;
  const stage: StageDoc = storedStage ?? CLASSIC_STAGE;
  const editable = canEditScope(scope, plan.targetKey);

  const api = useMemo<StageEditorApi>(() => {
    const pageId = stagePageId ?? "home";
    const commit = (secs: MSec[]) => {
      setProfileSettings(
        mergeScopedLayout(
          scope,
          profileSettings,
          plan.targetKey,
          withStage(doc, { sections: pruneEmpty(secs) }, pageId)
        )
      );
    };
    return {
      stage,
      stored: storedStage !== null,
      editable,
      stagePageId,
      stagePageName,
      enterStage: (id) => {
        setDrilled(id);
        setView({ mode: "outline" });
        setLibFor(null);
      },
      exitStage: () => {
        setDrilled(null);
        setView({ mode: "outline" });
        setLibFor(null);
      },
      view,
      setView,
      hover,
      setHover,
      libFor,
      setLibFor,
      mut: (fn) => {
        if (!editable) return;
        const secs = cloneSections(stage);
        if (fn(secs) === false) return;
        commit(secs);
      },
      reset: () => {
        if (!confirmReset) {
          setConfirmReset(true);
          window.setTimeout(() => setConfirmReset(false), 4000);
          return;
        }
        setConfirmReset(false);
        setView({ mode: "outline" });
        setProfileSettings(
          mergeScopedLayout(
            scope, profileSettings, plan.targetKey, withStage(doc, undefined, pageId)
          )
        );
      },
      confirmReset,
    };
  }, [
    stage, storedStage, editable, stagePageId, stagePageName,
    view, hover, libFor, confirmReset,
    scope, profileSettings, plan.targetKey, doc, setProfileSettings,
  ]);

  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}
