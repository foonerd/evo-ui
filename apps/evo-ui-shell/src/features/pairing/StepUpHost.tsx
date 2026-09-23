// StepUpHost - THE single operator-password card for the whole app.
// Mounted once at the app root. It installs a bridge into the WS
// transport (setStepUpBridge); any dispatch that classifyAuthz names
// elevate (subclass === step_up_required only) asks the bridge for a
// token, which raises THIS card, verifies the operator password, and
// hands the token back so the transport retries. One card, one in-
// memory token cache, every surface. Pair is a different ceremony.
//
// The token is held in memory only (never persisted), reused across the
// operator's sitting, and cleared by the transport when a retry shows it
// has expired.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { KeyRound } from "lucide-preact";
import { StepUpConfirm } from "../../components/StepUpConfirm";
import { PasswordField } from "../../components/PasswordField";
import { setStepUpBridge } from "../../runtime/ws-transport.ts";
import type { StepUpBridge } from "../../runtime/step-up-dispatch.ts";
import { stepUpVerify, retryAfterMinutes } from "../../runtime/session-trust";
import { storedBearer } from "../../runtime/bearer";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { createStepUpAcquireLane } from "./step-up-acquire-lane";

export function StepUpHost(): JSX.Element | null {
  useLocale();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const laneRef = useRef(createStepUpAcquireLane());
  const listenersRef = useRef(new Set<(token: string | null) => void>());

  useEffect(() => {
    const notify = (token: string | null): void => {
      listenersRef.current.forEach((listener) => listener(token));
    };
    const lane = laneRef.current;
    const bridge: StepUpBridge = {
      getToken: () => tokenRef.current,
      setToken: (token) => {
        tokenRef.current = token;
        notify(token);
      },
      acquire: () =>
        new Promise<string | null>((resolve) => {
          if (lane.enqueue(resolve)) {
            setPassword("");
            setError(null);
            setOpen(true);
          }
        }),
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        listener(tokenRef.current);
        return () => {
          listenersRef.current.delete(listener);
        };
      }
    };
    setStepUpBridge(bridge);
    return () => {
      setStepUpBridge(null);
      // Resolve any card left open on unmount as a cancel so no caller
      // hangs on the parked promise.
      if (lane.open) lane.settle(null);
    };
  }, []);

  const cancel = (): void => {
    setOpen(false);
    laneRef.current.settle(null);
  };

  const submit = async (): Promise<void> => {
    if (!laneRef.current.open || password.length === 0) return;
    setBusy(true);
    setError(null);
    let verify = await stepUpVerify(password, storedBearer());
    if (!verify.ok && verify.refusal === "step_up_nonce_reused") {
      verify = await stepUpVerify(password, storedBearer());
    }
    if (!verify.ok) {
      setBusy(false);
      if (verify.refusal === "invalid_credentials") {
        setError(t("stepup.wrongPassword"));
      } else if (verify.refusal === "step_up_rate_limited") {
        const minutes = retryAfterMinutes(verify.message);
        setError(
          minutes !== null
            ? t("stepup.rateLimited", { minutes })
            : t("stepup.rateLimitedNoFigure")
        );
      } else if (verify.refusal === "step_up_unavailable") {
        setError(t("stepup.unavailable"));
      } else if (verify.refusal === "step_up_backend_read_failed") {
        setError(t("stepup.backendReadFailed"));
      } else if (verify.refusal === "step_up_backend_verify_error") {
        setError(t("stepup.backendVerifyError"));
      } else if (verify.refusal === "user_not_permitted") {
        setError(t("stepup.playerNeedsUpdate"));
      } else {
        setError(
          verify.message.length > 0 ? verify.message : t("sources.refused")
        );
      }
      return;
    }
    tokenRef.current = verify.value;
    setBusy(false);
    setOpen(false);
    laneRef.current.settle(verify.value);
  };

  if (!open) return null;
  return (
    <StepUpConfirm
      icon={<KeyRound size={22} />}
      title={t("stepup.title")}
      body={t("stepup.body")}
      error={error}
      busy={busy}
      confirmLabel={t("stepup.confirm")}
      ariaLabel={t("stepup.title")}
      onCancel={cancel}
      onConfirm={() => void submit()}
    >
      <PasswordField
        className="evo-modal-input stepup-password-input"
        autofocus
        value={password}
        ariaLabel={t("stepup.passwordAria")}
        onInput={setPassword}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) void submit();
        }}
      />
    </StepUpConfirm>
  );
}
