// Captive portal sign-in via the framework's device-proxied session.
// When the device reports a captive network, the operator taps
// Sign in; we ask the plugin for a session and iframe the same-origin
// session_url. The framework proxies every request to the venue portal
// over the wlan0-bound wrapper, so the remote browser never touches the
// venue and any portal (including JS SPAs) renders as its real page. On
// finish we close the session, which re-probes reachability.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { deviceConnected } from "./network-nm-decoders";
import type { useNetworkLink } from "./useNetworkLink";

type Link = ReturnType<typeof useNetworkLink>;

export function CaptivePortal({ link }: { link: Link }): JSX.Element | null {
  useLocale();
  const [session, setSession] = useState<{ sessionId: string; sessionUrl: string } | null>(null);
  const cap = link.captive;
  if (cap === null) return null;

  // A captive sign-in only makes sense while Wi-Fi is actually associated.
  // captive.status is persisted (LKG shadow), so it can report an old
  // portal after wlan0 has dropped - don't surface a "sign in" prompt for
  // a network the device is no longer on.
  const wifiRow = link.deviceTable.find(
    (d) => d.ifname === link.intent.wifi.ifname || (/wifi|wireless/i.test(d.kind ?? "") && !/^ap/i.test(d.ifname))
  );
  const wifiUp = deviceConnected(wifiRow?.state ?? null);

  const active =
    cap.captive ||
    (cap.phase !== "idle" && cap.phase !== "Idle" && cap.phase !== "authenticated");
  if ((!active || !wifiUp) && session === null) return null;

  const busy = link.busy;

  const startSignIn = async (): Promise<void> => {
    const s = await link.startCaptiveSession();
    if (s !== null) setSession(s);
  };
  const finish = async (): Promise<void> => {
    const s = session;
    setSession(null);
    if (s !== null) await link.closeCaptiveSession(s.sessionId);
    else await link.completeCaptive();
  };

  return (
    <div className="net-captive">
      <span className="net-tile-title">{t("settings.network.captiveTitle")}</span>

      {session !== null ? (
        <>
          {/* Done/Cancel ride ABOVE the frame and stay pinned: on the short
              DSI panel the 520px frame otherwise pushes the action row below
              the fold, stranding "Done" out of reach. */}
          <div className="action-row net-captive-actions">
            <button type="button" className="settings-action-primary" disabled={busy} onClick={() => void finish()}>
              {t("settings.network.captiveFinished")}
            </button>
            <button type="button" disabled={busy} onClick={() => setSession(null)}>
              {t("dialog.cancel")}
            </button>
          </div>
          <p className="feature-description settings-help">{t("settings.network.captiveFrameHelp")}</p>
          <iframe
            className="net-captive-frame"
            src={session.sessionUrl}
            title={t("settings.network.captiveTitle")}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        </>
      ) : (
        <>
          <p className="feature-description settings-help">{t("settings.network.captiveSignInHelp")}</p>
          {cap.lastError !== null ? (
            <p className="feature-description settings-help net-notice">{cap.lastError}</p>
          ) : null}
          <div className="action-row">
            <button type="button" className="settings-action-primary" disabled={busy} onClick={() => void startSignIn()}>
              {t("settings.network.captiveSignIn")}
            </button>
            <button type="button" disabled={busy} onClick={() => void link.completeCaptive()}>
              {t("settings.network.captiveRecheck")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
