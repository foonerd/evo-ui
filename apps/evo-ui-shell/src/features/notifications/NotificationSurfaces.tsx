// NotificationSurfaces - bell, tray and banner stack (Phase 2b,
// ruled N1-A + P3-top on the mockup sheets).
//
// One component mounted once at App root. It owns the single
// useNotifications subscription and renders:
//   - the BELL: inline in the sidebar brand row is not possible
//     from here, so the bell is a floating affordance in the same
//     family as the drawer's .app-nav-fab (bottom-left stack) -
//     visible only when there is something to show or the tray is
//     open. No dead chrome on an idle system.
//   - the TRAY: a card panel anchored above the bell; ruled list
//     language; DnD switch in the head (on = display_only).
//   - BANNERS: attention layer band "banner", NON-modal - never
//     steals focus, never dims the app. Full layouts: floating
//     top-right stack (max 3). Compact panels (fold tiers) get one
//     full-width strip at the top via CSS.
//
// Dismiss routes to system.notifications.cancel. invoke_verb
// actions render DISABLED with a reason until action routing lands
// in 2c (shelf resolution from the plugin manifest is an open
// framework question) - no affordance without a complete flow.
//
// title_key / body_key are humanised until plugin catalogs are
// wired (open framework question); the source plugin is always
// shown verbatim.

import { useMemo, useState } from "preact/hooks";
import { Bell, BellOff, X } from "lucide-preact";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { useNotifications } from "./useNotifications";
import {
  formatMinute,
  humaniseKey,
  sortNotifications,
  type NotificationItem
} from "./notification-decoders";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

const MAX_BANNERS = 3;

export function NotificationSurfaces() {
  useLocale();
  const notifications = useNotifications();
  const [trayOpen, setTrayOpen] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<ReadonlySet<number>>(new Set());

  const state = notifications.state;
  const sorted = useMemo(
    () => (state === null ? [] : sortNotifications(state.active)),
    [state]
  );
  const count = sorted.length;
  const dnd = state?.baseMode === "display_only";

  // Banner queue: dismissed-locally banners stay out even before
  // the cancel round-trips; the tray still lists them until the
  // ledger drops them.
  const banners = useMemo(
    () => sorted.filter((n) => !dismissedBanners.has(n.handle)).slice(0, MAX_BANNERS),
    [sorted, dismissedBanners]
  );

  const dismiss = (item: NotificationItem) => {
    setDismissedBanners((prev) => new Set(prev).add(item.handle));
    void notifications.cancel(item.handle);
  };

  // Idle system, tray closed: no chrome at all.
  if (state === null || (count === 0 && !trayOpen)) return null;

  return (
    <>
      {/* Bell - floating affordance in the nav-fab family. */}
      <button
        type="button"
        className="app-nav-fab notif-bell"
        aria-label={t("notify.bellAria", { n: count })}
        aria-expanded={trayOpen}
        onClick={() => setTrayOpen((o) => !o)}
      >
        {dnd ? <BellOff size={18} /> : <Bell size={18} />}
        {count > 0 ? <span className="notif-badge">{count}</span> : null}
      </button>

      {/* Quiet-hours pill: only while a policy exists; lit inside
          the window. No dead chrome when quiet hours are off. */}
      {state.quietHours.startMinute !== 0 || state.quietHours.endMinute !== 0 ? (
        <span
          className={
            state.quietHoursActive ? "notif-qh-pill notif-qh-pill-on" : "notif-qh-pill"
          }
        >
          {t("notify.quietPill", {
            from: formatMinute(state.quietHours.startMinute),
            to: formatMinute(state.quietHours.endMinute)
          })}
        </span>
      ) : null}

      {/* Tray - anchored panel, ruled list language. */}
      {trayOpen ? (
        <div className="notif-tray card" role="region" aria-label={t("notify.trayTitle")}>
          <div className="notif-tray-head">
            <strong>{t("notify.trayTitle")}</strong>
            <span className="notif-tray-spacer" />
            <label className="notif-dnd">
              <span>{t("notify.dnd")}</span>
              <input
                type="checkbox"
                checked={dnd}
                onChange={() =>
                  void notifications.setBaseMode(dnd ? "chime" : "display_only")
                }
              />
            </label>
          </div>
          {count === 0 ? (
            <p className="notif-empty">{t("notify.empty")}</p>
          ) : (
            sorted.map((item) => (
              <div className="notif-row" key={item.handle}>
                <span className={`notif-pri notif-pri-${item.priority}`} aria-hidden />
                <div className="notif-row-body">
                  <p className="notif-row-title">
                    {humaniseKey(item.titleKey)}
                    {item.groupCount > 1 ? (
                      <span className="notif-gcount">{item.groupCount}</span>
                    ) : null}
                  </p>
                  <p className="notif-row-sub">
                    {item.sourcePlugin} - {t(`notify.priority.${item.priority}` as never)}
                  </p>
                </div>
                <button
                  type="button"
                  className="notif-x"
                  aria-label={t("notify.dismissAria")}
                  title={t("notify.dismissAria")}
                  onClick={() => dismiss(item)}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* Banners - non-modal attention band. Suppressed while the
          tray is open: the tray lists everything, and the stack
          would otherwise overlap it. */}
      {!trayOpen && banners.length > 0 ? (
        <AttentionOverlay
          band="banner"
          className="notif-banner-layer"
          modal={false}
        >
          {banners.map((item) => (
            <div
              className={`notif-banner card notif-banner-${item.priority}`}
              key={item.handle}
              role="status"
              aria-label={t(`notify.priority.${item.priority}` as never)}
            >
              <div className="notif-row-body">
                <p className="notif-row-title">
                  {humaniseKey(item.titleKey)}
                  {item.groupCount > 1 ? (
                    <span className="notif-gcount">{item.groupCount}</span>
                  ) : null}
                </p>
                {item.bodyKey !== null ? (
                  <p className="notif-row-sub">{humaniseKey(item.bodyKey)}</p>
                ) : null}
                <p className="notif-row-src">{item.sourcePlugin}</p>
                {item.actions.some((a) => a.kind === "invoke_verb") ? (
                  <div className="notif-banner-actions">
                    {item.actions
                      .filter((a) => a.kind === "invoke_verb")
                      .map((a) =>
                        a.kind === "invoke_verb" ? (
                          <button
                            key={a.verb}
                            type="button"
                            disabled
                            title={t("notify.actionPending")}
                          >
                            {humaniseKey(a.verb)}
                          </button>
                        ) : null
                      )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="notif-x"
                aria-label={t("notify.dismissAria")}
                onClick={() => dismiss(item)}
              >
                <X size={14} />
              </button>
              {item.autoDismissAfterMs !== null && item.priority !== "critical" ? (
                <span
                  className="notif-timer"
                  style={{ animationDuration: `${item.autoDismissAfterMs}ms` }}
                  aria-hidden
                />
              ) : null}
            </div>
          ))}
        </AttentionOverlay>
      ) : null}
    </>
  );
}
