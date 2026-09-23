// Settings > Metadata: per-source enable + priority.
//
// The operator's control over the framework-wide online-provider
// cascade. Each provider can be switched on/off and nudged up/down the
// priority order; the store hot-applies via its change bus, so a toggle
// takes effect on the next metadata verb with no restart.
//
// Rule (evo-device-audio@936480c): a stored key MEANS the provider is
// used - no second gesture. A keyed provider defaults on the moment its
// key lands in the vault; this toggle is the explicit off-switch that
// stops using it WITHOUT destroying the credential (deleting the key was
// the only off-switch before, which was a bad one). An identity-bearing
// provider with no key (honest has_credential:false) shows its row with
// the toggle inert and points at the Stored Keys panel - adding the key
// there both stores it and brings the provider up.
//
// Every write awaits the hook and paints its message on a refusal
// (household lock, scope, a write socket that could not open) - the
// same honesty as Stored Keys. A success paints nothing of its own: the
// hook re-lists on ok and the re-listed state is the paint.

import { useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useProviders, DEFAULT_PRIORITY } from "../providers/useProviders";
import type { ProviderActionResult } from "../providers/useProviders";
import {
  providerWriteFeedback,
  providerWriteOpensHousehold
} from "../providers/provider-write-feedback";
import type { PrivacyMode } from "../providers/provider-decoders";
import { useHouseholdModal } from "../household/HouseholdModalHost";

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
  // Keys are the kind tokens the framework listing actually emits
  // (verified live: bio / artist_artwork / album_artwork /
  // reconciliation ...). Legacy aliases kept so an older device still
  // renders a clean label.
  const known: Record<string, string> = {
    bio: "Bio",
    artist_bio: "Bio",
    album_notes: "Notes",
    lyrics: "Lyrics",
    release_credits: "Credits",
    track_annotation: "Annotation",
    work_notes: "Work notes",
    reconciliation: "Matching",
    artist_artwork: "Artist image",
    album_artwork: "Album art",
    artist_image: "Artist image",
    album_art: "Album art"
  };
  return known[kind] ?? kind.replace(/_/g, " ");
}

export function ProvidersPanel() {
  useLocale();
  const { entries, privacyMode, error, busy, setEnabled, setPriority, setPrivacyMode } =
    useProviders();
  const household = useHouseholdModal();

  // The last refused write's message; cleared at the start of the next
  // write. null while nothing has been refused.
  const [writeError, setWriteError] = useState<string | null>(null);

  const paintWrite = (r: ProviderActionResult): void => {
    setWriteError(providerWriteFeedback(r));
    if (providerWriteOpensHousehold(r) && household !== null) {
      household.open();
    }
  };

  const onSetPrivacyMode = async (mode: PrivacyMode): Promise<void> => {
    setWriteError(null);
    const r = await setPrivacyMode(mode);
    paintWrite(r);
  };

  const onSetPriority = async (
    providerId: string,
    priority: number
  ): Promise<void> => {
    setWriteError(null);
    const r = await setPriority(providerId, priority);
    paintWrite(r);
  };

  const onSetEnabled = async (
    providerId: string,
    enabled: boolean
  ): Promise<void> => {
    setWriteError(null);
    const r = await setEnabled(providerId, enabled);
    paintWrite(r);
  };

  const PRIVACY_MODES = ["enhanced", "anonymous_only", "offline"] as const;

  return (
    <div className="settings-section providers-panel">
      <h4 className="credentials-subhead">
        <SlidersHorizontal size={15} /> {t("providers.title")}
      </h4>
      <p className="feature-description">{t("providers.help")}</p>

      <div className="providers-privacy-control">
        <span className="providers-privacy-label">
          <ShieldCheck size={13} /> {t("providers.privacyTitle")}
        </span>
        <div
          className="collection-view-toggle"
          role="group"
          aria-label={t("providers.privacyTitle")}
        >
          {PRIVACY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={
                privacyMode === m
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              aria-pressed={privacyMode === m}
              disabled={busy}
              onClick={() => void onSetPrivacyMode(m)}
            >
              {t(`providers.privacy.${m}` as never)}
            </button>
          ))}
        </div>
      </div>

      {privacyMode !== "enhanced" ? (
        <p className="providers-privacy-banner" role="status">
          {privacyMode === "offline"
            ? t("providers.privacyOffline")
            : t("providers.privacyAnonymousOnly")}
        </p>
      ) : null}

      {error !== null ? (
        <p className="credentials-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {writeError !== null ? (
        <p className="credentials-feedback" role="alert">
          {writeError}
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
            // Privacy posture is non-bypassable framework-side and
            // outranks the operator's per-provider toggle. offline
            // suppresses every network provider; anonymous_only
            // suppresses identity-bearing ones. The row shows this as
            // an inert "Disabled by Privacy mode" state WITHOUT
            // touching p.enabled - the operator's choice is preserved
            // underneath and returns when they leave the posture.
            const suppressed =
              privacyMode === "offline" ||
              (privacyMode === "anonymous_only" &&
                p.privacyClass === "identity_bearing");
            const effectiveOn = p.enabled && !suppressed;
            return (
              <li
                key={p.providerId}
                className={
                  "provider-row" +
                  (effectiveOn ? " provider-row-on" : "") +
                  (suppressed ? " provider-row-suppressed" : "")
                }
              >
                <div className="provider-main">
                  <span className="provider-name">
                    {providerLabel(p.providerId)}
                  </span>
                  <span className="provider-meta">
                    {suppressed ? (
                      <span className="provider-chip provider-chip-privacy">
                        {t("providers.suppressedByPrivacy")}
                      </span>
                    ) : needsKey ? (
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
                      onClick={() => void onSetPriority(p.providerId, eff - 10)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("providers.lower")}
                      title={t("providers.lower")}
                      disabled={busy || i === entries.length - 1}
                      onClick={() => void onSetPriority(p.providerId, eff + 10)}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    // Effective state, not raw intent: a screen reader
                    // must not hear "on" while the posture suppresses it.
                    aria-checked={effectiveOn}
                    className={
                      effectiveOn
                        ? "provider-toggle provider-toggle-on"
                        : "provider-toggle"
                    }
                    // Inert when the posture suppresses it (can't be
                    // bypassed here) or when a keyed provider has no key
                    // in the vault (nothing to turn on - points at
                    // Stored Keys). p.enabled is never mutated in either
                    // case, so the operator's choice survives.
                    disabled={busy || needsKey || suppressed}
                    title={
                      suppressed
                        ? t("providers.suppressedByPrivacyHint")
                        : needsKey
                          ? t("providers.needsKeyHint")
                          : undefined
                    }
                    aria-label={
                      suppressed
                        ? t("providers.suppressedByPrivacyHint")
                        : needsKey
                          ? t("providers.needsKeyHint")
                          : undefined
                    }
                    onClick={() => void onSetEnabled(p.providerId, !p.enabled)}
                  >
                    {suppressed
                      ? t("providers.off")
                      : p.enabled
                        ? t("providers.on")
                        : t("providers.off")}
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
