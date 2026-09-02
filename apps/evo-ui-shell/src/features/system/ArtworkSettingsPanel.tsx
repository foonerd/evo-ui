// Settings > Metadata: artwork preferences + maintenance.
//
// Sits beside the credentials panel in the metadata group - the one
// home for "everything artwork/metadata": sources + keys (credentials),
// preferred image size, and clearing the artwork cache. Placed here, not
// in Operations, so a subsystem's settings and its maintenance action
// live together (Operations is for privileged/step-up/diagnostics only).
//
// Clear artwork cache is GLOBAL today (both verbs wipe everything):
// artwork.local.clear_cache wipes the on-disk cover cache;
// artwork.online.clear_cache drops the in-mem reconcile + provider LRUs.
// Per-item clear (from a tile kebab) needs a targeted verb the framework
// does not expose yet - tracked separately.

import { useState } from "preact/hooks";
import { ImageOff, Ruler } from "lucide-preact";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import type { WireOpResult } from "../../sdk/types";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  ARTWORK_SIZES,
  readArtworkSize,
  writeArtworkSize,
  type ArtworkSize
} from "../library/artwork-size";

export function ArtworkSettingsPanel() {
  useLocale();
  const transport = tryUseFrameworkTransport();
  const [size, setSize] = useState<ArtworkSize>(() => readArtworkSize());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const pick = (s: ArtworkSize): void => {
    writeArtworkSize(s);
    setSize(s);
  };

  const clearCache = async (): Promise<void> => {
    if (transport === null) {
      setFeedback(t("artwork.notConnected"));
      return;
    }
    if (busy) return;
    setBusy(true);
    setFeedback("");
    // The clear verbs succeed at the framework level; artwork.local's
    // clear response does not carry a payload_b64 envelope, so
    // pluginRequest reports `plugin_response_decode` even though the
    // clear ran. Treat that specific decode code as success - the op
    // completed; only its (empty) body was undecodable.
    const ran = (r: WireOpResult): boolean =>
      r.error === undefined || r.error.code === "plugin_response_decode";
    // Both clear verbs are stocked on the multi-occupant
    // "artwork.providers" shelf (artwork.local + artwork.online).
    const local = await pluginRequest(
      transport,
      "artwork.providers",
      "artwork.local.clear_cache",
      { v: 1 }
    );
    const online = await pluginRequest(
      transport,
      "artwork.providers",
      "artwork.online.clear_cache",
      { v: 1 }
    );
    setBusy(false);
    if (ran(local) && ran(online)) {
      setFeedback(t("artwork.cacheCleared"));
    } else {
      setFeedback(t("artwork.cacheClearFailed"));
    }
  };

  return (
    <div className="settings-section artwork-settings">
      <h4 className="credentials-subhead">
        <Ruler size={15} /> {t("artwork.size.title")}
      </h4>
      <p className="feature-description">{t("artwork.size.help")}</p>
      <div
        className="collection-view-toggle artwork-size-toggle"
        role="group"
        aria-label={t("artwork.size.title")}
      >
        {ARTWORK_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={
              size === s
                ? "collection-view-toggle-button collection-view-toggle-active"
                : "collection-view-toggle-button"
            }
            aria-pressed={size === s}
            onClick={() => pick(s)}
          >
            {t(`artwork.size.${s}` as never)}
          </button>
        ))}
      </div>

      <h4 className="credentials-subhead">
        <ImageOff size={15} /> {t("artwork.clearCache.title")}
      </h4>
      <p className="feature-description">{t("artwork.clearCache.help")}</p>
      <button
        type="button"
        className="library-action-danger"
        disabled={busy || transport === null}
        onClick={() => void clearCache()}
      >
        {busy ? t("artwork.clearCache.working") : t("artwork.clearCache.action")}
      </button>

      {feedback ? (
        <p className="credentials-feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
