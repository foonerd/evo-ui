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
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  ARTWORK_SIZES,
  clearArtwork,
  readArtworkSize,
  writeArtworkSize,
  type ArtworkSize
} from "../library/artwork-size";

export function ArtworkSettingsPanel() {
  useLocale();
  const [size, setSize] = useState<ArtworkSize>(() => readArtworkSize());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const pick = (s: ArtworkSize): void => {
    writeArtworkSize(s);
    setSize(s);
  };

  const clearCache = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    // All-scope eviction via the one authenticated destructive gesture.
    // Removes downloaded artwork across every tier (resolve-index entries,
    // asset bytes, plugin memo); local folder/embedded art is a different
    // plugin and is kept. Only a real 2xx is reported as success - a
    // capability refusal must never read as "cleared".
    const r = await clearArtwork();
    setBusy(false);
    setFeedback(r.ok ? t("artwork.cacheCleared") : t("artwork.cacheClearFailed"));
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
        disabled={busy}
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
