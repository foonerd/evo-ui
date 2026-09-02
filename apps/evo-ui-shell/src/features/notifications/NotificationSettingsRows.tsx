// NotificationSettingsRows - the three behaviour rows in
// Settings > System (Phase 2c, ruled N2-A). Reuses the existing
// settings-row chrome and the shared Modal for the quiet-hours
// editor; no new visual language.
//
//   - Mode: Silent (display_only) / Chime / Voice -
//     system.notifications.set_base_mode. Mirrors the tray's DnD
//     switch (Silent IS do-not-disturb).
//   - Quiet hours: window display; "off - tap to enable" when
//     0/0; "crosses midnight" hint when end < start. Editor is a
//     shared-Modal dialog with two native time fields.
//   - During quiet hours: Display only / Chime downgrade.

import { useState } from "preact/hooks";
import { Modal } from "../../components/dialogs";
import { useNotifications } from "./useNotifications";
import { formatMinute, parseTimeToMinute } from "./notification-decoders";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { TimeField } from "../../components/TimeField";

const MODES = ["display_only", "chime", "voice"] as const;
const DOWNGRADES = ["display_only", "chime"] as const;

function modeLabel(mode: string): string {
  if (mode === "display_only") return t("notify.mode.silent");
  if (mode === "voice") return t("notify.mode.voice");
  return t("notify.mode.chime");
}

export function NotificationSettingsRows() {
  useLocale();
  const notifications = useNotifications();
  const [editorOpen, setEditorOpen] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const state = notifications.state;
  if (state === null) return null;

  const policy = state.quietHours;
  const off = policy.startMinute === 0 && policy.endMinute === 0;
  const crossesMidnight = !off && policy.endMinute < policy.startMinute;

  const run = async (op: () => Promise<{ ok: boolean; message?: string }>) => {
    setFeedback("");
    const r = await op();
    if (!r.ok) setFeedback(r.message ?? t("notify.refused"));
  };

  return (
    <>
      <div className="settings-row">
        <span className="settings-label-text">{t("notify.settings.mode")}</span>
        <div className="stb-seg" role="radiogroup" aria-label={t("notify.settings.mode")}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={state.baseMode === mode ? "on" : undefined}
              role="radio"
              aria-checked={state.baseMode === mode}
              onClick={() => void run(() => notifications.setBaseMode(mode))}
            >
              {modeLabel(mode)}
            </button>
          ))}
        </div>
        <p className="feature-description settings-help">
          {t("notify.settings.modeHelp")}
        </p>
      </div>

      <div className="settings-row">
        <span className="settings-label-text">{t("notify.settings.quietHours")}</span>
        <button
          type="button"
          className="settings-link-button"
          onClick={() => setEditorOpen(true)}
        >
          {off
            ? t("notify.settings.quietOff")
            : `${formatMinute(policy.startMinute)} - ${formatMinute(policy.endMinute)}`}
          {crossesMidnight ? ` (${t("notify.settings.crossesMidnight")})` : ""}
        </button>
        {state.quietHoursActive ? (
          <p className="feature-description settings-help">
            {t("notify.settings.quietActiveNow")}
          </p>
        ) : null}
      </div>

      {!off ? (
        <div className="settings-row">
          <span className="settings-label-text">{t("notify.settings.downgrade")}</span>
          <div className="stb-seg" role="radiogroup" aria-label={t("notify.settings.downgrade")}>
            {DOWNGRADES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={policy.downgradeMode === mode ? "on" : undefined}
                role="radio"
                aria-checked={policy.downgradeMode === mode}
                onClick={() =>
                  void run(() =>
                    notifications.setQuietHours(policy.startMinute, policy.endMinute, mode)
                  )
                }
              >
                {modeLabel(mode)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {feedback.length > 0 ? (
        <p className="feature-description settings-help" role="alert">{feedback}</p>
      ) : null}

      {editorOpen ? (
        <QuietHoursEditor
          startMinute={policy.startMinute}
          endMinute={policy.endMinute}
          onCancel={() => setEditorOpen(false)}
          onSave={(start, end) => {
            setEditorOpen(false);
            void run(() =>
              notifications.setQuietHours(start, end, policy.downgradeMode)
            );
          }}
          onClear={() => {
            setEditorOpen(false);
            void run(() =>
              notifications.setQuietHours(0, 0, policy.downgradeMode)
            );
          }}
        />
      ) : null}
    </>
  );
}

function QuietHoursEditor({
  startMinute,
  endMinute,
  onCancel,
  onSave,
  onClear
}: {
  startMinute: number;
  endMinute: number;
  onCancel: () => void;
  onSave: (start: number, end: number) => void;
  onClear: () => void;
}) {
  useLocale();
  const [start, setStart] = useState(formatMinute(startMinute === 0 && endMinute === 0 ? 1320 : startMinute));
  const [end, setEnd] = useState(formatMinute(startMinute === 0 && endMinute === 0 ? 420 : endMinute));
  const parsedStart = parseTimeToMinute(start);
  const parsedEnd = parseTimeToMinute(end);
  const valid = parsedStart !== null && parsedEnd !== null;
  const crosses = valid && parsedEnd < parsedStart;
  return (
    <Modal title={t("notify.settings.quietHours")} onCancel={onCancel}>
      <div className="notify-qh-fields">
        <label className="evo-modal-label">
          {t("notify.settings.from")}
          <TimeField
            className="evo-modal-input"
            value={start}
            onChange={setStart}
          />
        </label>
        <label className="evo-modal-label">
          {t("notify.settings.to")}
          <TimeField
            className="evo-modal-input"
            value={end}
            onChange={setEnd}
          />
        </label>
      </div>
      {crosses ? (
        <p className="evo-modal-hint">{t("notify.settings.crossesMidnight")}</p>
      ) : null}
      <div className="evo-modal-actions">
        <button
          type="button"
          className="evo-modal-button evo-modal-button-secondary"
          onClick={onClear}
        >
          {t("notify.settings.turnOff")}
        </button>
        <button
          type="button"
          className="evo-modal-button evo-modal-button-primary"
          disabled={!valid}
          onClick={() => {
            if (parsedStart !== null && parsedEnd !== null) onSave(parsedStart, parsedEnd);
          }}
        >
          {t("dialog.save")}
        </button>
      </div>
    </Modal>
  );
}
