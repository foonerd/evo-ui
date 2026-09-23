// LibraryScanHeartbeat - large working heartbeat while a store
// is indexing. The count and bar move with the scan-progress
// subject so a 500k walk cannot be mistaken for a stuck one.

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  scanElapsedLabel,
  scanProgressRatio,
  type LibraryScanHeartbeatModel
} from "./scan-progress-line";

export function LibraryScanHeartbeat(
  props: LibraryScanHeartbeatModel
): JSX.Element {
  useLocale();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  const ratio = scanProgressRatio(props.scanned, props.total);
  const countLine =
    props.total !== null
      ? t("library.indexingOf", {
          scanned: props.scanned.toLocaleString(),
          total: props.total.toLocaleString()
        })
      : props.scanned > 0
        ? t("library.indexing", {
            scanned: props.scanned.toLocaleString()
          })
        : t("library.indexingUnderway");
  const elapsed =
    props.startedAtMs !== null
      ? t("library.heartbeat.elapsed", {
          elapsed: scanElapsedLabel(props.startedAtMs, nowMs)
        })
      : null;

  return (
    <HeartbeatPanel
      visible
      mode="working"
      headline={t("library.heartbeat.indexing", { name: props.name })}
      sublabel={
        <div className="library-scan-progress">
          <p className="library-scan-progress-count">{countLine}</p>
          {ratio !== null ? (
            <progress
              className="library-scan-progress-bar"
              max={1}
              value={ratio}
            />
          ) : (
            <progress className="library-scan-progress-bar" />
          )}
          {elapsed !== null ? (
            <p className="library-scan-progress-elapsed">{elapsed}</p>
          ) : null}
        </div>
      }
    />
  );
}

/** Heartbeat while SMB / NFS / any attached store is retracted.
 *  The scan-progress subject names the work; this is the glass. */
export function LibraryRetractHeartbeat(props: { name: string }): JSX.Element {
  useLocale();
  return (
    <HeartbeatPanel
      visible
      mode="working"
      headline={t("library.heartbeat.removing", { name: props.name })}
      sublabel={t("library.removeStageRetract")}
    />
  );
}
