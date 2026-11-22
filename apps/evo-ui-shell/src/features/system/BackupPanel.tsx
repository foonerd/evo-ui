// BackupPanel - the Backup stage: export the configuration as one backup,
// and import one back.
//
// Export sends once and the answered backup is what the box holds. The box
// is the operator's to copy and to paste into; a paste replaces what it
// holds and sends nothing. Import asks first and sends once, with the
// backup in the box; a box that does not hold a backup sends nothing, and
// cancel sends nothing. The answer lists every item an owner refused; an
// empty list says every item went back. A refused verb leaves the box as it
// was. While a verb is in flight the stage is locked and neither button
// sends.

import { useState } from "preact/hooks";
import { Download, Upload } from "lucide-preact";
import { useSystemBackup } from "./useSystemBackup";
import { backupText, parseBackupText, type BackupRefusal } from "./backup";
import { ConfirmDialog } from "../../components/dialogs";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function BackupPanel() {
  useLocale();
  const { exportBackup, importBackup } = useSystemBackup();
  const [text, setText] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<BackupRefusal[] | null>(null);
  const [importAsk, setImportAsk] = useState<boolean>(false);

  const locked = busy;
  const parses = parseBackupText(text) !== null;

  const onExport = async (): Promise<void> => {
    if (locked) return;
    setBusy(true);
    setError(null);
    const r = await exportBackup();
    setBusy(false);
    if (r.ok) {
      setText(backupText(r.value));
      setRefused(null);
    } else {
      setError(r.message);
    }
  };

  const onAskImport = (): void => {
    if (locked) return;
    if (parseBackupText(text) === null) return;
    setImportAsk(true);
  };

  const onConfirmImport = async (): Promise<void> => {
    setImportAsk(false);
    if (locked) return;
    const backup = parseBackupText(text);
    if (backup === null) return;
    setBusy(true);
    setError(null);
    const r = await importBackup(backup);
    setBusy(false);
    if (r.ok) {
      setRefused(r.value);
    } else {
      setError(r.message);
    }
  };

  return (
    <div className="system-backup">
      <div className="audio-eq-preset-line">
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={locked}
          onClick={() => void onExport()}
        >
          <Download size={14} /> {t("settings.backup.export")}
        </button>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={locked || !parses}
          onClick={onAskImport}
        >
          <Upload size={14} /> {t("settings.backup.import")}
        </button>
      </div>
      <label className="settings-label system-backup-text" htmlFor="system-backup-text">
        <span>{t("settings.backup.textLabel")}</span>
        <textarea
          id="system-backup-text"
          rows={12}
          spellcheck={false}
          value={text}
          disabled={locked}
          onInput={(ev) => setText((ev.currentTarget as HTMLTextAreaElement).value)}
        />
      </label>
      <p className="audio-stage-note">{t("settings.backup.textHint")}</p>
      {text.trim().length > 0 && !parses ? (
        <p className="audio-stage-note" role="status">{t("settings.backup.notParsed")}</p>
      ) : null}

      {error !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {refused !== null ? (
        refused.length === 0 ? (
          <p className="audio-stage-note" role="status">{t("settings.backup.allBack")}</p>
        ) : (
          <div role="status">
            <p className="audio-dsp-title">{t("settings.backup.refusedTitle")}</p>
            <ul className="system-backup-refused">
              {refused.map((r, i) => (
                <li key={`${i}:${r.domain}:${r.item}`}>
                  {t("settings.backup.refusedRow", { domain: r.domain, item: r.item, reason: r.reason })}
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {importAsk ? (
        <ConfirmDialog
          title={t("settings.backup.importTitle")}
          message={t("settings.backup.importAsk")}
          confirmLabel={t("settings.backup.import")}
          onConfirm={() => void onConfirmImport()}
          onCancel={() => setImportAsk(false)}
        />
      ) : null}
    </div>
  );
}
