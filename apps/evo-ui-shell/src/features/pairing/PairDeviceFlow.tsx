// PairDeviceFlow - pair THIS browser with the player by typing the
// player's system password (RULED 2026-07-20: the installation
// user's OS password - set at image-flash / OS install, verified by
// the framework's shadow backend - IS the trust ceremony; the code
// and preseed ceremonies are rejected as the consumer path).
//
// Wire: pair_authenticate { device_hint, secret_b64, nonce } ->
// { pair_completed, token, expires_at_ms, paired_device_id }.
// Refusals reuse the step-up catalogue (invalid_credentials /
// step_up_rate_limited / step_up_nonce_reused) - a password guess
// is a password guess, one limiter bucket.
//
// Success stores the paired bearer (localStorage + subprotocol -
// the supported path) and reloads so every transport
// re-handshakes with it.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { Modal } from "../../components/dialogs";
import { PasswordField } from "../../components/PasswordField";
import { pairAuthenticate, storeBearer } from "../../runtime/session-trust";
import { retryAfterMinutes } from "../../runtime/session-trust";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

function refusalCopy(refusal: string, message: string): string {
  if (refusal === "invalid_credentials") return t("pairing.auth.wrongPassword");
  if (refusal === "step_up_rate_limited") {
    const minutes = retryAfterMinutes(message);
    return minutes !== null
      ? t("stepup.rateLimited", { minutes })
      : t("stepup.rateLimitedNoFigure");
  }
  if (refusal === "unreachable") return t("pairing.refusal.unreachable");
  if (refusal === "unknown_op" || refusal === "invalid_payload") {
    // Substrate predating the pair_authenticate ruling.
    return t("stepup.playerNeedsUpdate");
  }
  return message.length > 0 ? message : t("sources.refused");
}

function deviceHint(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad/.test(ua)) return "iOS browser";
  if (/Android/.test(ua)) return "Android browser";
  if (/Macintosh/.test(ua)) return "Mac browser";
  if (/Windows/.test(ua)) return "Windows browser";
  if (/Linux/.test(ua)) return "Linux browser";
  return "Browser";
}

export function PairDeviceFlow({
  onClose,
  onPaired
}: {
  onClose: () => void;
  /** When provided, called after the bearer is stored INSTEAD of a full
   *  page reload - so a surface (e.g. the network page) can re-establish
   *  its bearer socket in place and keep the operator where they are.
   *  When absent, we reload so every mounted transport re-handshakes. */
  onPaired?: (token: string) => void;
}): JSX.Element {
  useLocale();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const submit = async (): Promise<void> => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError("");
    const r = await pairAuthenticate(deviceHint(), password);
    if (!r.ok) {
      setBusy(false);
      setError(refusalCopy(r.refusal, r.message));
      return;
    }
    storeBearer(r.value.token);
    if (onPaired !== undefined) {
      onPaired(r.value.token);
      return;
    }
    // No in-place handler: reload so every mounted transport
    // re-handshakes with the paired bearer.
    window.location.reload();
  };

  return (
    <Modal title={t("pairing.title")} onCancel={onClose}>
      <p className="evo-modal-hint">{t("pairing.auth.body")}</p>
      <label className="evo-modal-label">
        {t("pairing.auth.passwordLabel")}
        <PasswordField
          className="evo-modal-input"
          autofocus
          value={password}
          onInput={setPassword}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </label>
      <div className="evo-modal-actions">
        <button
          type="button"
          className="evo-modal-button evo-modal-button-secondary"
          disabled={busy}
          onClick={onClose}
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="evo-modal-button evo-modal-button-primary"
          disabled={busy || password.length === 0}
          onClick={() => void submit()}
        >
          {t("pairing.auth.submit")}
        </button>
      </div>
      {error.length > 0 ? (
        <p className="evo-modal-hint pairing-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
