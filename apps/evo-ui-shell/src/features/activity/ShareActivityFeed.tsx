// Share operations feed. Lives under Settings -> Activity.
// Sources is the operational surface; this list is retrospective.
//
// Last-N operator lines (connected / failed). A failure because
// the share was still in use adds the one classified sentence
// (share-busy). Event detail, holders and the mount-unit journal
// stay off this list.

import { AlertTriangle, ArrowDownToLine, Check } from "lucide-preact";
import type { JSX } from "preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { isBusyEvent } from "../sources/share-busy";
import type { ShareEventKind } from "../sources/share-decoders";
import { useNetworkShares } from "../sources/useNetworkShares";

function eventIcon(kind: ShareEventKind): JSX.Element {
  if (kind === "mounted") return <Check size={14} />;
  if (kind === "unmounted") return <ArrowDownToLine size={14} />;
  return <AlertTriangle size={14} />;
}

function eventLabelKey(kind: ShareEventKind): string {
  return `sources.event.${kind}`;
}

function relTime(atMs: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffS = Math.round((atMs - Date.now()) / 1000);
  const abs = Math.abs(diffS);
  if (abs < 60) return rtf.format(diffS, "second");
  if (abs < 3600) return rtf.format(Math.round(diffS / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffS / 60 / 60), "hour");
  return rtf.format(Math.round(diffS / 86400), "day");
}

export function ShareActivityFeed() {
  useLocale();
  const shares = useNetworkShares();
  const configured = shares.items ?? [];

  return (
    <div className="activity-shares">
      <p className="activity-section-title">{t("activity.shares")}</p>
      {shares.events.length === 0 ? (
        <p className="activity-history-empty">{t("activity.sharesEmpty")}</p>
      ) : (
        <ul className="sources-activity">
          {shares.events
            .slice()
            .reverse()
            .slice(0, 12)
            .map((ev, i) => {
              const share = configured.find((s) => s.shareId === ev.shareId);
              const name = ev.alias ?? share?.alias ?? null;
              const failed =
                ev.kind === "mount_failed" || ev.kind === "unmount_failed";
              return (
                <li
                  key={`${ev.atMs}-${ev.shareId}-${i}`}
                  className={
                    failed
                      ? "sources-activity-item sources-activity-failed"
                      : "sources-activity-item"
                  }
                >
                  <span className="sources-activity-icon" aria-hidden>
                    {eventIcon(ev.kind)}
                  </span>
                  <div className="sources-activity-body">
                    <span className="sources-activity-line">
                      <strong>{name ?? t("sources.activity.unnamedShare")}</strong>{" "}
                      {t(eventLabelKey(ev.kind) as never)}
                      {ev.negotiatedVersion !== null
                        ? ` (${ev.negotiatedVersion})`
                        : ""}
                    </span>
                    {isBusyEvent(ev) ? (
                      <span className="sources-activity-reason">
                        {t("err.shareBusy")}
                      </span>
                    ) : null}
                  </div>
                  <span className="sources-activity-time">
                    {relTime(ev.atMs)}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
