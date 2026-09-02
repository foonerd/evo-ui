// Designer history provider - binds the pure DesignerHistory core to
// the scoped layout slot. It OBSERVES the stored layout (raw slot,
// not the synthesized fallback) for the current scope/target: every
// change from ANY builder becomes an undo point with zero call-site
// changes, and can never be missed by a new editor. Undo/redo
// re-commit the recorded snapshot through the same single write path
// the editors use.
//
// Chrome: visible Undo/Redo buttons (accessibility requirement -
// keyboard-only affordances are not enough) plus Ctrl+Z /
// Ctrl+Shift+Z / Ctrl+Y, suppressed while typing in a field so the
// browser's native input undo keeps working.

import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Redo2, Undo2 } from "lucide-preact";

import { usePresentation } from "../runtime/presentation-context";
import {
  resolveLayoutDocument,
  resolveRemoteLayoutDocument,
} from "../runtime/presentation-target";
import { decodeLayoutDocument, type LayoutDocument } from "../runtime/layout-document";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { useDesignerScope } from "./designer-scope";
import { mergeScopedLayout } from "./designer-layout-io";
import { DesignerHistory, type HistoryEntry } from "./designer-history";

interface HistoryApi {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;
}

const Ctx = createContext<HistoryApi | null>(null);

export function useDesignerHistory(): HistoryApi {
  const api = useContext(Ctx);
  if (api === null) throw new Error("useDesignerHistory outside provider");
  return api;
}

export function DesignerHistoryProvider(props: { children: ComponentChildren }): JSX.Element {
  const { profileSettings, setProfileSettings, plan } = usePresentation();
  const { scope } = useDesignerScope();
  const historyRef = useRef(new DesignerHistory());
  const [, bump] = useState(0);
  const rerender = () => bump((n) => (n + 1) % 1e6);

  // The observed slot: RAW stored layout (null = nothing stored).
  const stored: LayoutDocument | null =
    scope === "remote"
      ? resolveRemoteLayoutDocument(profileSettings)
      : resolveLayoutDocument(plan.targetKey, profileSettings);
  const json = stored === null ? null : JSON.stringify(stored);
  const slotKey = `${scope}:${plan.targetKey ?? ""}`;

  const latestRef = useRef<{ slotKey: string; json: string | null }>({ slotKey, json });
  const suppressRef = useRef(false);

  useEffect(() => {
    const prev = latestRef.current;
    latestRef.current = { slotKey, json };
    if (prev.slotKey !== slotKey) {
      // Scope/target switch is navigation, not an edit.
      historyRef.current.breakBurst();
      return;
    }
    if (prev.json === json) return;
    if (suppressRef.current) {
      // Our own undo/redo landing - not a fresh edit.
      suppressRef.current = false;
      rerender();
      return;
    }
    historyRef.current.push({
      scope,
      targetKey: plan.targetKey,
      json: prev.json,
    });
    rerender();
  }, [slotKey, json, scope, plan.targetKey]);

  const api = useMemo<HistoryApi>(() => {
    const commitEntry = (entry: HistoryEntry) => {
      const layout =
        entry.json === null
          ? undefined
          : decodeLayoutDocument(JSON.parse(entry.json)) ?? undefined;
      suppressRef.current = true;
      setProfileSettings(
        mergeScopedLayout(entry.scope, profileSettings, entry.targetKey, layout)
      );
    };
    const current = (): HistoryEntry => ({
      scope,
      targetKey: plan.targetKey,
      json: latestRef.current.json,
    });
    return {
      canUndo: historyRef.current.canUndo,
      canRedo: historyRef.current.canRedo,
      undo: () => {
        const entry = historyRef.current.undo(current());
        if (entry !== null) commitEntry(entry);
        rerender();
      },
      redo: () => {
        const entry = historyRef.current.redo(current());
        if (entry !== null) commitEntry(entry);
        rerender();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSettings, setProfileSettings, scope, plan.targetKey, json]);

  // Keyboard: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y. Fields keep
  // their native input undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); api.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); api.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  return <Ctx.Provider value={api}>{props.children}</Ctx.Provider>;
}

/** Visible undo/redo chrome - lives beside the scope picker. */
export function DesignerHistoryControls(): JSX.Element {
  useLocale();
  const h = useDesignerHistory();
  return (
    <span class="designer-history" role="group" aria-label={t("builder.historyGroup")}>
      <button type="button" disabled={!h.canUndo}
        title={t("builder.undoTitle")} aria-label={t("builder.undo")}
        onClick={h.undo}>
        <Undo2 size={13} />
      </button>
      <button type="button" disabled={!h.canRedo}
        title={t("builder.redoTitle")} aria-label={t("builder.redo")}
        onClick={h.redo}>
        <Redo2 size={13} />
      </button>
    </span>
  );
}
