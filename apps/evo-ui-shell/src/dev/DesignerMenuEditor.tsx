// Designer Menu tab - the v7 builder chrome applied to the sidebar
// menu: an OUTLINE of entry chips grouped at dividers with hover
// actions, "+" opening a small library (divider / restore hidden
// entries), and per-entry SETTINGS pages plus one Menu-chrome page
// (position, mode, power cluster). Every curation rule survives the
// re-chrome: destinations hide via the eye and never delete, Home is
// presence-locked, dividers alone do not curate, the default
// arrangement stores nothing, and the standard reset stays two-step.
// All model edits route through dev/designer-menu.ts as before.

import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Minus,
  Navigation,
  Pencil,
  RotateCcw,
  Settings2,
} from "lucide-preact";

import { curatableNavDefaults } from "../app/App";
import { LANDING_NAV_ID } from "../app/nav-curation";
import { usePresentation } from "../runtime/presentation-context";
import type { LayoutDocument } from "../runtime/layout-document";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { useDesignerScope } from "./designer-scope";
import {
  canEditScope,
  mergeScopedLayout,
  resolveScopedLayout,
  scopeBannerText,
} from "./designer-layout-io";
import {
  addDivider,
  isDefaultArrangement,
  layoutWithMenu,
  menuItemsFromDocument,
  menuRowKey,
  moveMenuItem,
  removeMenuItem,
  setMenuItemLabel,
  setMenuItemVisible,
  setNavMode,
  setNavPosition,
  setNavPower,
  type MenuEditorItem,
} from "./designer-menu";
import { BackBar, BuilderLibrary, Lbl, Seg } from "./builder-controls";
import { useDeviceSetting } from "./use-device-setting";

type TriMode = "auto" | "on" | "off";
const isTriMode = (v: unknown): v is TriMode =>
  v === "auto" || v === "on" || v === "off";

/** Works shelf policy - a DEVICE setting since consolidation slice 3
 *  (ui.works.shelf_mode; was a per-browser Settings row). It lives on
 *  the Works ENTRY because it IS entry curation: Auto follows the
 *  library counters, On forces the entry, Off hides it always. */
function WorksShelfControl(): JSX.Element {
  const shelf = useDeviceSetting<TriMode>("ui.works.shelf_mode", isTriMode, "auto");
  return (
    <>
      <Lbl text={t("menu.worksShelf")} help={t("menu.worksShelfHelp")} />
      <Seg
        options={["auto", "on", "off"] as const}
        value={shelf.value}
        label={(v) => t(`settings.mode.${v}` as never)}
        onChange={shelf.set}
      />
      {shelf.error ? <p class="stb-refusal">{t("viz.saveFailed")}</p> : null}
    </>
  );
}

type MenuView = { mode: "outline" } | { mode: "entry"; key: string } | { mode: "chrome" };

export function DesignerMenuEditor(): JSX.Element {
  useLocale();
  const { profileSettings, setProfileSettings, plan } = usePresentation();
  const { scope } = useDesignerScope();
  const [view, setView] = useState<MenuView>({ mode: "outline" });
  const [libOpen, setLibOpen] = useState(false);

  const storedDoc = useMemo(
    () => resolveScopedLayout(scope, plan.targetKey, profileSettings),
    [scope, plan.targetKey, profileSettings]
  );
  const storedDocJson = useMemo(
    () => (storedDoc === null ? "null" : JSON.stringify(storedDoc)),
    [storedDoc]
  );

  const [items, setItems] = useState<readonly MenuEditorItem[]>(() =>
    menuItemsFromDocument(curatableNavDefaults(), storedDoc)
  );
  // Re-derive rows when the stored document changes identity - target
  // switch in the picker, or device settings arriving after mount.
  useEffect(() => {
    setItems(menuItemsFromDocument(curatableNavDefaults(), storedDoc));
  }, [storedDocJson]); // eslint-disable-line

  const commitItems = (next: readonly MenuEditorItem[]) => {
    setItems(next);
    setProfileSettings(
      mergeScopedLayout(
        scope,
        profileSettings,
        plan.targetKey,
        layoutWithMenu(storedDoc, next, curatableNavDefaults())
      )
    );
  };
  const commitDoc = (next: LayoutDocument | undefined) => {
    setProfileSettings(
      mergeScopedLayout(scope, profileSettings, plan.targetKey, next)
    );
  };

  const curated = !isDefaultArrangement(items, curatableNavDefaults());

  // Destructive: two-step confirm (rev-205 rule).
  const [confirmStd, setConfirmStd] = useState(false);
  const resetToStandard = () => {
    if (!confirmStd) {
      setConfirmStd(true);
      window.setTimeout(() => setConfirmStd(false), 4000);
      return;
    }
    setConfirmStd(false);
    setView({ mode: "outline" });
    commitItems(menuItemsFromDocument(curatableNavDefaults(), null));
  };

  if (!canEditScope(scope, plan.targetKey)) {
    return (
      <div className="designer-menu" role="group" aria-label="Menu editor">
        <div className="stb-head"><span className="designer-menu-label">{t("menu.title")}</span></div>
        <p className="designer-tab-hint designer-scope-line">
          {scopeBannerText(scope, plan.targetKey)}
        </p>
      </div>
    );
  }

  /* ---------------- settings: one entry ---------------- */
  if (view.mode === "entry") {
    const index = items.findIndex((it) => menuRowKey(it) === view.key);
    const item = index >= 0 ? items[index] : undefined;
    if (item === undefined) {
      setView({ mode: "outline" });
      return <></>;
    }
    const isDivider = item.kind === "divider";
    const isHome = item.kind === "view" && item.id === LANDING_NAV_ID;
    return (
      <div className="designer-menu stb-settings" role="group" aria-label="Menu entry settings">
        <BackBar title={isDivider ? t("menu.divider") : item.defaultLabel || t("menu.entry")}
          onBack={() => setView({ mode: "outline" })} />
        <Lbl text={t("menu.entry.label")}
          help={isDivider ? t("menu.entry.labelHelp") : undefined} />
        <input
          key={`${view.key}:${item.label}`}
          type="text"
          className="designer-menu-name"
          defaultValue={item.label}
          aria-label={t("menu.entry.label")}
          onChange={(e) =>
            commitItems(setMenuItemLabel(items, view.key, (e.target as HTMLInputElement).value))
          }
        />
        {!isDivider && item.label !== item.defaultLabel ? (
          <p class="stb-help">{t("menu.entry.default", { name: item.defaultLabel })}</p>
        ) : null}

        {!isDivider ? (
          <>
            <Lbl text={t("menu.entry.visibility")} help={isHome ? t("menu.homeLocked") : undefined} />
            <Seg
              options={["visible", "hidden"] as const}
              value={item.visible ? "visible" : "hidden"}
              label={(v) => (v === "visible" ? t("menu.visible") : t("menu.hidden"))}
              disabled={() => isHome}
              disabledTitle={() => t("menu.homeLocked")}
              onChange={(v) => commitItems(setMenuItemVisible(items, view.key, v === "visible"))}
            />
          </>
        ) : null}

        {/* The Works destination may ride as "view" (defaults) or
          * "page" (a stored layout defines a works page) - the shelf
          * policy belongs to the DESTINATION, so key on the id. */}
        {item.kind !== "divider" && item.id === "works" ? <WorksShelfControl /> : null}

        <Lbl text={t("menu.entry.position")} />
        <div class="stb-rowline">
          <button type="button" disabled={index === 0}
            onClick={() => commitItems(moveMenuItem(items, view.key, -1))}>
            <ArrowUp size={12} /> {t("menu.moveUp")}
          </button>
          <button type="button" disabled={index === items.length - 1}
            onClick={() => commitItems(moveMenuItem(items, view.key, 1))}>
            <ArrowDown size={12} /> {t("menu.moveDown")}
          </button>
        </div>

        {isDivider ? (
          <>
            <button type="button" class="stb-danger"
              onClick={() => {
                commitItems(removeMenuItem(items, view.key));
                setView({ mode: "outline" });
              }}>
              {t("menu.removeDivider")}
            </button>
            <p class="stb-help">{t("menu.removeDividerHelp")}</p>
          </>
        ) : null}
      </div>
    );
  }

  /* ---------------- settings: menu chrome ---------------- */
  if (view.mode === "chrome") {
    const position = storedDoc?.nav.position ?? "left";
    return (
      <div className="designer-menu stb-settings" role="group" aria-label="Menu chrome settings">
        <BackBar title={t("menu.chrome")} onBack={() => setView({ mode: "outline" })} />
        <Lbl text={t("menu.position")} />
        <Seg
          options={["left", "right", "none"] as const}
          value={position}
          label={(v) => t(`menu.pos.${v === "none" ? "hidden" : v}` as never)}
          onChange={(v) => commitDoc(setNavPosition(storedDoc, v))}
        />
        <Lbl text={t("menu.mode")} help={t("menu.modeHelp")} />
        <Seg
          options={["pinned", "slide"] as const}
          value={storedDoc?.nav.mode ?? "pinned"}
          label={(v) => t(`menu.mode.${v}` as never)}
          disabled={() => position === "none"}
          disabledTitle={() => t("menu.pos.hidden")}
          onChange={(v) => commitDoc(setNavMode(storedDoc, v))}
        />
        <Lbl text={t("menu.power")} help={t("menu.powerHelp")} />
        <Seg
          options={["pinned", "hidden"] as const}
          value={storedDoc?.nav.power ?? "pinned"}
          label={(v) => t(`menu.power.${v}` as never)}
          onChange={(v) => commitDoc(setNavPower(storedDoc, v))}
        />
      </div>
    );
  }

  /* ---------------- outline ---------------- */
  const hiddenItems = items.filter((it) => it.kind !== "divider" && !it.visible);
  return (
    <div className="designer-menu" role="group" aria-label="Menu editor">
      <div className="stb-head">
        <span className="designer-menu-label">{t("menu.title")}</span>
        <span className="stb-state">{curated ? t("menu.curated") : t("menu.standard")}</span>
        <button type="button" title={t("menu.chromeTitle")}
          onClick={() => setView({ mode: "chrome" })}>
          <Settings2 size={12} /> {t("menu.chrome")}
        </button>
        <button type="button" disabled={!curated}
          className={confirmStd ? "on" : ""}
          title={t("menu.standardTitle")}
          onClick={resetToStandard}>
          <RotateCcw size={12} /> {confirmStd ? t("menu.standardConfirm") : t("menu.standardReset")}
        </button>
      </div>
      <p className="designer-tab-hint">{t("menu.outlineHint")}</p>

      <div className="stb-outline">
        {items.map((item, index) => {
          const key = menuRowKey(item);
          const acts = (
            <span class="stb-acts">
              <button type="button" title={t("builder.settings")}
                onClick={(e) => { e.stopPropagation(); setView({ mode: "entry", key }); }}>
                <Pencil size={12} />
              </button>
              <button type="button" title={t("menu.moveUp")} disabled={index === 0}
                onClick={(e) => { e.stopPropagation(); commitItems(moveMenuItem(items, key, -1)); }}>
                <ArrowUp size={12} />
              </button>
              <button type="button" title={t("menu.moveDown")} disabled={index === items.length - 1}
                onClick={(e) => { e.stopPropagation(); commitItems(moveMenuItem(items, key, 1)); }}>
                <ArrowDown size={12} />
              </button>
              {item.kind !== "divider" ? (
                item.kind === "view" && item.id === LANDING_NAV_ID ? (
                  <button type="button" disabled title={t("menu.homeLocked")}>
                    <Lock size={12} />
                  </button>
                ) : (
                  <button type="button"
                    title={item.visible ? t("menu.hidden") : t("menu.visible")}
                    aria-pressed={item.visible}
                    onClick={(e) => {
                      e.stopPropagation();
                      commitItems(setMenuItemVisible(items, key, !item.visible));
                    }}>
                    {item.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                )
              ) : null}
            </span>
          );
          if (item.kind === "divider") {
            return (
              <div key={key} class="stb-divchip" onClick={() => setView({ mode: "entry", key })}>
                <Minus size={11} />
                <span>{item.label === "" ? "──" : item.label}</span>
                {acts}
              </div>
            );
          }
          return (
            <div key={key}
              class={"stb-el" + (item.visible ? "" : " stb-dim")}
              onClick={() => setView({ mode: "entry", key })}>
              {item.kind === "page"
                ? <Layers size={13} aria-label={t("menu.pageBadge")} />
                : <Navigation size={13} />}
              <span>{item.label}</span>
              {item.label !== item.defaultLabel ? (
                <small class="stb-note">({item.defaultLabel})</small>
              ) : null}
              {acts}
            </div>
          );
        })}
        <div class="stb-plusrow">
          <button type="button" class="stb-plus" title={t("menu.lib.title")}
            onClick={() => setLibOpen(true)}>+</button>
        </div>
      </div>

      <p className="designer-tab-hint designer-scope-line">
        {scopeBannerText(scope, plan.targetKey)}
      </p>

      {libOpen ? (
        <BuilderLibrary
          title={t("menu.lib.title")}
          groups={[
            {
              label: t("menu.lib.structure"),
              items: [{ key: "__divider", label: t("menu.divider"), icon: <Minus size={20} /> }],
            },
            ...(hiddenItems.length > 0
              ? [{
                  label: t("menu.lib.hiddenGroup"),
                  items: hiddenItems.map((it) => ({
                    key: menuRowKey(it),
                    label: it.label,
                    icon: it.kind === "page" ? <Layers size={20} /> : <Navigation size={20} />,
                  })),
                }]
              : []),
          ]}
          onPick={(key) => {
            if (key === "__divider") commitItems(addDivider(items));
            else commitItems(setMenuItemVisible(items, key, true));
            setLibOpen(false);
          }}
          onClose={() => setLibOpen(false)}
        />
      ) : null}
    </div>
  );
}
