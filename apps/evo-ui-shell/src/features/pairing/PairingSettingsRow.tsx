// PairingSettingsRow - the Settings > System entry into the pair
// ceremony (screen 2). Shows this browser's trust state (UI
// enablement only - authority is framework-side) and launches
// PairDeviceFlow.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { storedBearer, bearerExpiresAtMs } from "../../runtime/bearer";
import { PairDeviceFlow } from "./PairDeviceFlow";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function PairingSettingsRow(): JSX.Element {
  useLocale();
  const [open, setOpen] = useState(false);
  const token = storedBearer();
  const expiresAtMs = bearerExpiresAtMs(token);
  const paired =
    token !== undefined && (expiresAtMs === null || expiresAtMs > Date.now());

  return (
    <div className="settings-row">
      <span className="settings-label-text">{t("pairing.settings.label")}</span>
      <button
        type="button"
        className="settings-link-button"
        onClick={() => setOpen(true)}
      >
        {paired ? t("pairing.settings.repair") : t("pairing.settings.pair")}
      </button>
      <p className="feature-description settings-help">
        {paired
          ? expiresAtMs !== null
            ? t("pairing.settings.pairedUntil", {
                when: new Date(expiresAtMs).toLocaleString()
              })
            : t("pairing.settings.paired")
          : t("pairing.settings.notPaired")}
      </p>
      {open ? <PairDeviceFlow onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
