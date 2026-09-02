// PromptSurface - renders the framework's user-interaction prompts
// per the ruled attention-surfaces sheet (P1-A centered card in the
// dialog language, P2-A one prompt at a time with a waiting count).
//
// Mounted ONCE at App root; renders nothing unless the responder
// hook is active AND at least one prompt is open. Rides the prompt
// band (above dialogs and step-up - the framework interrupts the
// app, not the other way round). No ESC, no backdrop dismiss:
// Cancel is an explicit wire answer, never an accident.
//
// Passwords: type=password, explicit show toggle, never echoed to
// assistive tech (the toggle flips the input type only). Unknown
// prompt kinds render the SDK-mandated newer-client fallback with
// Cancel as the only action.

import { useEffect, useState } from "preact/hooks";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { usePromptResponder } from "./usePromptResponder";
import type { PromptAnswer, PromptItem } from "./prompt-decoders";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function PromptSurface() {
  useLocale();
  const responder = usePromptResponder();
  if (responder.status !== "active" || responder.prompts.length === 0) {
    return null;
  }
  const current = responder.prompts[0];
  const waiting = responder.prompts.length - 1;
  return (
    <PromptCard
      key={`${current.plugin}#${current.promptId}`}
      item={current}
      waiting={waiting}
      onAnswer={responder.answer}
      onCancel={responder.cancel}
    />
  );
}

interface PromptCardProps {
  item: PromptItem;
  waiting: number;
  onAnswer: (item: PromptItem, a: PromptAnswer) => Promise<{ ok: boolean; message?: string }>;
  onCancel: (item: PromptItem) => Promise<{ ok: boolean; message?: string }>;
}

function PromptCard({ item, waiting, onAnswer, onCancel }: PromptCardProps) {
  useLocale();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh prompt gets a fresh form (key on the caller resets
  // state; this guards the same-key re-issue path too).
  useEffect(() => {
    setError(item.errorContext);
  }, [item]);

  const run = async (op: () => Promise<{ ok: boolean; message?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await op();
    setBusy(false);
    if (!r.ok) setError(r.message ?? t("prompt.refused"));
  };

  const kind = item.promptType;
  const title =
    kind.kind === "confirm"
      ? kind.message
      : kind.kind === "unknown"
        ? t("prompt.unknownTitle")
        : kind.label;

  const submitText = () =>
    run(() =>
      onAnswer(item, { kind: kind.kind === "password" ? "password" : "text", value })
    );

  return (
    <AttentionOverlay
      band="prompt"
      className="evo-modal-root prompt-root"
      role="dialog"
      ariaLabel={title}
    >
      <div className="evo-modal-card prompt-card">
        {waiting > 0 ? (
          <span className="prompt-pending">
            {t("prompt.moreWaiting", { n: waiting })}
          </span>
        ) : null}
        <div className="prompt-origin">
          {t("prompt.requestFrom")}
          <span className="prompt-origin-chip">{item.plugin}</span>
        </div>
        <h4 className="evo-modal-title prompt-title">{title}</h4>

        {kind.kind === "text" || kind.kind === "password" ? (
          <form
            className="evo-modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitText();
            }}
          >
            <div className="prompt-field">
              <input
                className="evo-modal-input"
                type={kind.kind === "password" && !reveal ? "password" : "text"}
                value={value}
                placeholder={kind.kind === "text" ? (kind.placeholder ?? undefined) : undefined}
                autocomplete={kind.kind === "password" ? "new-password" : "off"}
                onInput={(event) =>
                  setValue((event.currentTarget as HTMLInputElement).value)
                }
              />
              {kind.kind === "password" ? (
                <button
                  type="button"
                  className="prompt-reveal"
                  onClick={() => setReveal((r) => !r)}
                  aria-pressed={reveal}
                >
                  {reveal ? t("prompt.hide") : t("prompt.show")}
                </button>
              ) : null}
            </div>
            {error !== null ? (
              <p className="prompt-error" role="alert">{error}</p>
            ) : null}
            <div className="evo-modal-actions">
              <button
                type="button"
                className="evo-modal-button evo-modal-button-secondary"
                disabled={busy}
                onClick={() => void run(() => onCancel(item))}
              >
                {t("dialog.cancel")}
              </button>
              <button
                type="submit"
                className="evo-modal-button evo-modal-button-primary"
                disabled={busy || value.length === 0}
              >
                {t("prompt.submit")}
              </button>
            </div>
          </form>
        ) : kind.kind === "confirm" ? (
          <>
            {error !== null ? (
              <p className="prompt-error" role="alert">{error}</p>
            ) : null}
            <div className="evo-modal-actions">
              <button
                type="button"
                className="evo-modal-button evo-modal-button-secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => onAnswer(item, { kind: "confirm", value: false }))
                }
              >
                {t("prompt.no")}
              </button>
              <button
                type="button"
                className="evo-modal-button evo-modal-button-primary"
                disabled={busy}
                onClick={() =>
                  void run(() => onAnswer(item, { kind: "confirm", value: true }))
                }
              >
                {t("prompt.yes")}
              </button>
            </div>
          </>
        ) : kind.kind === "select" ? (
          <>
            <div className="prompt-options" role="radiogroup" aria-label={kind.label}>
              {kind.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={
                    selected === option.id
                      ? "prompt-option prompt-option-selected"
                      : "prompt-option"
                  }
                  role="radio"
                  aria-checked={selected === option.id}
                  onClick={() => setSelected(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {error !== null ? (
              <p className="prompt-error" role="alert">{error}</p>
            ) : null}
            <div className="evo-modal-actions">
              <button
                type="button"
                className="evo-modal-button evo-modal-button-secondary"
                disabled={busy}
                onClick={() => void run(() => onCancel(item))}
              >
                {t("dialog.cancel")}
              </button>
              <button
                type="button"
                className="evo-modal-button evo-modal-button-primary"
                disabled={busy || selected === null}
                onClick={() => {
                  if (selected === null) return;
                  void run(() =>
                    onAnswer(item, { kind: "select", option_id: selected })
                  );
                }}
              >
                {t("prompt.submit")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="evo-modal-body">{t("prompt.unknownBody")}</p>
            <div className="evo-modal-actions">
              <button
                type="button"
                className="evo-modal-button evo-modal-button-secondary"
                disabled={busy}
                onClick={() => void run(() => onCancel(item))}
              >
                {t("dialog.cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </AttentionOverlay>
  );
}
