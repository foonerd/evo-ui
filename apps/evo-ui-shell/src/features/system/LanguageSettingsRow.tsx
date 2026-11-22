// LanguageSettingsRow - the operator's language on the System group.
//
// One button per offered language (the glass ships one catalogue, en).
// Choosing one sends language.set once; while a send is in flight the row
// sends nothing. The answer names the language now in force, and that is
// what the glass shows, through the existing locale switch - never the tag
// that was sent. An answered language the glass has no catalogue for is
// named in a note and the screen stays as it is. This row does not write
// the ui.locale setting the first-boot path follows.

import { useState } from "preact/hooks";
import { useSystemLocale } from "./useSystemLocale";
import { OFFERED_LANGUAGES } from "./language";
import { activeLocale, isLocaleId, setLocale, t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function LanguageSettingsRow() {
  useLocale();
  const { setLanguage } = useSystemLocale();
  const [busy, setBusy] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  const onChoose = async (tag: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const r = await setLanguage(tag);
    setBusy(false);
    if (!r.ok) {
      setNote(r.message);
      return;
    }
    if (isLocaleId(r.value)) {
      setLocale(r.value);
    } else {
      setNote(t("settings.language.cannotShow", { tag: r.value }));
    }
  };

  const current = activeLocale();
  return (
    <div className="settings-row">
      <span className="settings-label-text">{t("settings.language.title")}</span>
      <div className="stb-seg" role="radiogroup" aria-label={t("settings.language.title")}>
        {OFFERED_LANGUAGES.map((tag) => (
          <button
            key={tag}
            type="button"
            className={current === tag ? "on" : undefined}
            role="radio"
            aria-checked={current === tag}
            disabled={busy}
            onClick={() => void onChoose(tag)}
          >
            {t(`settings.language.name.${tag}` as never)}
          </button>
        ))}
      </div>
      <p className="feature-description settings-help">{t("settings.language.help")}</p>
      {note !== null ? (
        <p className="feature-description settings-help" role="status">{note}</p>
      ) : null}
    </div>
  );
}
