// Settings > Metadata: per-source enable + priority.
//
// The operator's control over the framework-wide online-provider
// cascade. Each provider can be switched on/off and nudged up/down the
// priority order; the store hot-applies via its change bus, so a toggle
// takes effect on the next metadata verb with no restart. A stored key
// (credentials panel) does nothing until its provider is enabled here -
// this panel is what turns a saved Last.fm/Discogs/Genius key from inert
// into used. "Needs key" marks an identity-bearing provider whose key is
// absent from the vault (honest has_credential from the framework).

import { ChevronDown, ChevronUp, KeyRound, SlidersHorizontal } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useProviders, DEFAULT_PRIORITY } from "../providers/useProviders";

/** Proper-noun display names - not i18n (brand names don't translate). */
const PROVIDER_LABELS: Record<string, string> = {
  musicbrainz: "MusicBrainz",
  lastfm: "Last.fm",
  discogs: "Discogs",
  genius: "Genius",
  theaudiodb: "TheAudioDB",
  wikipedia: "Wikipedia",
  wikidata: "Wikidata",
  deezer: "Deezer",
  fanart_tv: "fanart.tv",
  volumio_meta: "Volumio Metadata",
  cover_art_archive: "Cover Art Archive",
  itunes: "iTunes",
  lrclib: "LRCLIB"
};

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/** Content-kind chips: known kinds get a clean label; unknown ones fall
 *  back to the raw token with underscores softened. */
function prettyKind(kind: string): string {
  const known: Record<string, string> = {
    artist_bio: "Bio",
    album_notes: "Notes",
    lyrics: "Lyrics",
    release_credits: "Credits",
    track_annotation: "Annotation",
    work_notes: "Work notes",
    artist_image: "Artist image",
    album_art: "Album art"
  };
  return known[kind] ?? kind.replace(/_/g, " ");
}

export function ProvidersPanel() {
  useLocale();
  const { entries, error, busy, setEnabled, setPriority } = useProviders();

  return (
    <div className="settings-section providers-panel">
      <h4 className="credentials-subhead">
        <SlidersHorizontal size={15} /> {t("providers.title")}
      </h4>
      <p className="feature-description">{t("providers.help")}</p>

      {error !== null ? (
        <p className="credentials-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {entries === null ? (
        <p className="feature-description">{t("providers.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="feature-description">{t("providers.empty")}</p>
      ) : (
        <ul className="providers-list">
          {entries.map((p, i) => {
            const eff = p.priority ?? DEFAULT_PRIORITY;
            const needsKey =
              !p.hasCredential && p.privacyClass !== "anonymous";
            return (
              <li
                key={p.providerId}
                className={
                  p.enabled ? "provider-row provider-row-on" : "provider-row"
                }
              >
                <div className="provider-main">
                  <span className="provider-name">
                    {providerLabel(p.providerId)}
                  </span>
                  <span className="provider-meta">
                    {needsKey ? (
                      <span className="provider-chip provider-chip-warn">
                        <KeyRound size={11} /> {t("providers.needsKey")}
                      </span>
                    ) : null}
                    {p.kinds.slice(0, 3).map((k) => (
                      <span key={k} className="provider-chip">
                        {prettyKind(k)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="provider-actions">
                  <div className="provider-priority">
                    <button
                      type="button"
                      aria-label={t("providers.raise")}
                      title={t("providers.raise")}
                      disabled={busy || i === 0}
                      onClick={() => void setPriority(p.providerId, eff - 10)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("providers.lower")}
                      title={t("providers.lower")}
                      disabled={busy || i === entries.length - 1}
                      onClick={() => void setPriority(p.providerId, eff + 10)}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    className={
                      p.enabled
                        ? "provider-toggle provider-toggle-on"
                        : "provider-toggle"
                    }
                    disabled={busy}
                    onClick={() => void setEnabled(p.providerId, !p.enabled)}
                  >
                    {p.enabled ? t("providers.on") : t("providers.off")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
