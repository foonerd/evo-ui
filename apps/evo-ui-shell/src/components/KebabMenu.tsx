// KebabMenu - THE overflow menu of the ruled list-element standard.
//
// Every track tile's toolbox is at most two icon actions plus this
// kebab (vertical-dots) button; ALL remaining verbs live here as
// icon + text rows. One shared implementation so behaviour is
// identical on every surface:
//   - opens on tap, positioned under the trigger, clamped to the
//     viewport (flips above when there is no room below)
//   - closes on outside pointerdown, on Escape (focus returns to
//     the trigger), and after selecting an item
//   - danger rows (remove from queue/playlist/favourites) carry a
//     distinct style
//
// The trigger inherits the shared toolbox button styling from
// `.track-tile-actions button` / `.kebab-menu-trigger` - icon only,
// explicit padding: 0 (global button padding trap).

import { Fragment, type ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { MoreVertical } from "lucide-preact";
import { t } from "../runtime/i18n";

export interface KebabMenuItem {
  id: string;
  icon: ComponentChildren;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Render a thin divider row above this item - groups related
   *  actions (e.g. playback actions above, artwork maintenance
   *  below) within one menu. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface KebabMenuProps {
  items: readonly KebabMenuItem[];
  /** Disables the trigger (surface-level busy flag). */
  disabled?: boolean;
  /** aria-label/title for the trigger. Defaults to the shared
   *  "More actions" catalog string. */
  label?: string;
}

/** Estimated popup metrics for pre-render viewport clamping. Kept in
 *  sync with the .kebab-menu-popup CSS (row padding + font size). */
const MENU_WIDTH = 200;
const MENU_ROW_HEIGHT = 34;
const MENU_PADDING = 12;
const VIEWPORT_MARGIN = 8;

export function KebabMenu({ items, disabled = false, label }: KebabMenuProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null
  );
  const open = position !== null;

  const close = useCallback(() => setPosition(null), []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    const height = items.length * MENU_ROW_HEIGHT + MENU_PADDING;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)
    );
    const below = rect.bottom + 4;
    const top =
      below + height > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, rect.top - height - 4)
        : below;
    setPosition({ left, top });
  }, [open, close, items.length]);

  // Outside-click + Escape dismissal while open. pointerdown (not
  // click) so a drag that starts outside also dismisses.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const triggerLabel = label ?? t("playlist.moreActions");

  return (
    <span className="kebab-menu" ref={rootRef}>
      <button
        type="button"
        className="kebab-menu-trigger"
        ref={triggerRef}
        onClick={toggle}
        disabled={disabled}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={14} />
      </button>
      {open ? (
        <div
          className="kebab-menu-popup"
          role="menu"
          style={{ left: `${position.left}px`, top: `${position.top}px` }}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore === true ? (
                <div className="kebab-menu-sep" role="separator" />
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={
                  item.danger === true ? "kebab-menu-danger" : undefined
                }
                disabled={item.disabled === true}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                <span className="kebab-menu-item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </span>
  );
}
