// Operator credential-management panel for the online providers.
//
// Enumerates the keyed providers across BOTH provider plugins
// (metadata.online: Last.fm / Discogs / Genius; artwork.online:
// fanart.tv), lists the stored keys (display_name + last-updated), and
// an add form whose provider select spans every keyed provider, each
// linking to its registration page. The value field is masked and
// write-only (there is no credential_get) - submitting blank does
// nothing, submitting a value overwrites. Delete removes an entry by
// its key_hash, so any stored credential is removable regardless of
// which plugin owns it.

import { useState } from "preact/hooks";
import { ExternalLink, Trash2, KeyRound } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import type { MessageKey } from "../../locales/en";
import { useCredentials } from "./useCredentials";
import { EvoSelect } from "../../components/EvoSelect";

/** The two provider plugins whose vault keys this panel manages. */
const METADATA_PLUGIN = "org.evoframework.metadata.online";
const ARTWORK_PLUGIN = "org.evoframework.artwork.online";

/** Every keyed provider the operator can add, with the plugin whose
 *  vault holds it and its provider registration page. display_name is
 *  what gets stored + shown. */
interface KeyedProvider {
  pluginId: string;
  key: string;
  displayNameKey: MessageKey;
  url: string;
}

const KEYED_PROVIDERS: ReadonlyArray<KeyedProvider> = [
  {
    pluginId: METADATA_PLUGIN,
    key: "lastfm_api_key",
    displayNameKey: "credentials.key.lastfm",
    url: "https://www.last.fm/api/account/create"
  },
  {
    pluginId: METADATA_PLUGIN,
    key: "discogs_personal_access_token",
    displayNameKey: "credentials.key.discogs",
    url: "https://www.discogs.com/settings/developers"
  },
  {
    pluginId: METADATA_PLUGIN,
    key: "genius_client_access_token",
    displayNameKey: "credentials.key.genius",
    url: "https://genius.com/api-clients"
  },
  {
    pluginId: ARTWORK_PLUGIN,
    key: "fanart_tv_personal_api_key",
    displayNameKey: "credentials.key.fanart",
    url: "https://fanart.tv/get-an-api-key/"
  }
];

function formatUpdated(ms: number | null): string {
  if (ms === null) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export function CredentialsPanel() {
  useLocale();
  // One hook per provider plugin. Two fixed calls (no hooks-in-loop):
  // the keyed providers live in exactly these two plugins today.
  const metaCreds = useCredentials(METADATA_PLUGIN);
  const artCreds = useCredentials(ARTWORK_PLUGIN);

  const [selectedKey, setSelectedKey] = useState<string>(
    KEYED_PROVIDERS[0].key
  );
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const credsFor = (pluginId: string) =>
    pluginId === ARTWORK_PLUGIN ? artCreds : metaCreds;

  const selected =
    KEYED_PROVIDERS.find((p) => p.key === selectedKey) ?? KEYED_PROVIDERS[0];

  // Merge the two plugins' listings, tagging each entry with the plugin
  // that owns it so removal routes back to the right vault. null only
  // while BOTH first listings are still outstanding.
  const listing:
    | ReadonlyArray<{
        pluginId: string;
        keyHash: string;
        displayName: string | null;
        updatedAtMs: number | null;
      }>
    | null =
    metaCreds.entries === null && artCreds.entries === null
      ? null
      : [
          ...(metaCreds.entries ?? []).map((e) => ({
            pluginId: METADATA_PLUGIN,
            keyHash: e.keyHash,
            displayName: e.displayName,
            updatedAtMs: e.updatedAtMs
          })),
          ...(artCreds.entries ?? []).map((e) => ({
            pluginId: ARTWORK_PLUGIN,
            keyHash: e.keyHash,
            displayName: e.displayName,
            updatedAtMs: e.updatedAtMs
          }))
        ];

  const error = metaCreds.error ?? artCreds.error;

  const onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Write-only, empty-means-unchanged: a blank submit is a no-op.
    if (value.trim().length === 0 || busy) return;
    setBusy(true);
    setFeedback("");
    const r = await credsFor(selected.pluginId).addKey({
      key: selected.key,
      value: value.trim(),
      displayName: t(selected.displayNameKey)
    });
    setBusy(false);
    if (r.ok) {
      setValue("");
      setFeedback(t("credentials.saved", { name: t(selected.displayNameKey) }));
    } else {
      setFeedback(r.message);
    }
  };

  const onRemove = async (
    pluginId: string,
    keyHash: string,
    name: string
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const r = await credsFor(pluginId).removeKey(keyHash);
    setBusy(false);
    setFeedback(r.ok ? t("credentials.removed", { name }) : r.message);
  };

  return (
    <div className="credentials-panel">
      <p className="feature-description">{t("credentials.summary")}</p>

      {error !== null ? <p className="feature-hint">{error}</p> : null}

      <h4 className="credentials-subhead">{t("credentials.storedTitle")}</h4>
      {listing === null ? (
        <p className="credentials-empty">{t("credentials.loading")}</p>
      ) : listing.length === 0 ? (
        <p className="credentials-empty">{t("credentials.none")}</p>
      ) : (
        <ul className="credentials-list">
          {listing.map((entry) => {
            const name = entry.displayName ?? t("credentials.unnamed");
            return (
              <li
                key={`${entry.pluginId}:${entry.keyHash}`}
                className="credentials-row"
              >
                <span className="credentials-row-icon" aria-hidden>
                  <KeyRound size={16} />
                </span>
                <span className="credentials-row-text">
                  <span className="credentials-row-name">{name}</span>
                  {entry.updatedAtMs !== null ? (
                    <span className="credentials-row-meta">
                      {t("credentials.updated", {
                        when: formatUpdated(entry.updatedAtMs)
                      })}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="credentials-remove"
                  disabled={busy}
                  onClick={() =>
                    void onRemove(entry.pluginId, entry.keyHash, name)
                  }
                  aria-label={t("credentials.remove", { name })}
                  title={t("credentials.remove", { name })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="credentials-subhead">{t("credentials.addTitle")}</h4>
      <form className="credentials-add" onSubmit={(e) => void onSubmit(e)}>
        <div className="credentials-add-row">
          <label className="credentials-field credentials-field-grow">
            <span>{t("credentials.provider")}</span>
            <EvoSelect
              ariaLabel={t("credentials.provider")}
              value={selectedKey}
              options={KEYED_PROVIDERS.map((p) => ({
                value: p.key,
                label: t(p.displayNameKey)
              }))}
              onChange={setSelectedKey}
            />
          </label>

          <a
            className="credentials-provider-link"
            href={selected.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={13} />
            {t("credentials.getKey")}
          </a>
        </div>

        <label className="credentials-field">
          <span>{t("credentials.value")}</span>
          <input
            type="password"
            autoComplete="off"
            spellcheck={false}
            value={value}
            placeholder={t("credentials.valuePlaceholder")}
            onInput={(e) =>
              setValue((e.currentTarget as HTMLInputElement).value)
            }
          />
        </label>

        <div className="credentials-add-actions">
          <button
            type="submit"
            className="credentials-save"
            disabled={busy || value.trim().length === 0}
          >
            {t("credentials.save")}
          </button>
        </div>
      </form>

      {feedback ? (
        <p className="credentials-feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
