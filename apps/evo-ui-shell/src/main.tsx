// Entry point for the operator UI shell.
//
// The shell renders the App component at
// (apps/evo-ui-shell/src/app/App.tsx). App.tsx bootstraps against
// the UI runtime's local /api/ui/v1/* endpoints (health,
// capabilities, settings).
//
// Feature modules (e.g. features/multiroom/) connect to the
// framework's wire-op surface using **relative** URLs resolved
// against the page origin. The UI runtime reverse-proxies the
// framework HTTP + WebSocket traffic to the framework's loopback
// HTTPS substrate; the operator's browser only ever speaks plain
// HTTP to this runtime on port 80. No TLS, no certificate, no SAN
// games surface in the operator session.
//
// The schema-first runtime (./runtime/boot.tsx + ./runtime/Shell.tsx)
// is preserved in source. Full switch back happens when the
// framework's multi-room widget kinds are admitted on the
// `multiroom.devices` shelf and the declarative composition layer
// has shelves to render against. Until then, App.tsx is the entry
// and multi-room cards live in their own feature module against the
// transport layer directly.

import { render } from "preact";
import { useEffect } from "preact/hooks";

import { App } from "./app/App";
import { NativeMirror } from "./app/NativeMirror";
import { DisplayTestLab, isDesignerMode } from "./dev/DisplayTestLab";
import { PresentationProvider, usePresentation } from "./runtime/presentation-context";
import { onEmbedProfileChange, readEmbedProfile } from "./runtime/designer-embed";
import { isLoopbackHost, scopeFromPath } from "./runtime/session-scope";
import { startBundleUpdater } from "./runtime/bundle-updater";
import "./styles.css";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element");
}

resolveBearerToken();
registerServiceWorker();

if (isDesignerMode()) {
  render(<DisplayTestLab />, root);
} else if (isNativeMirror()) {
  // /native from a remote browser: simulate the attached glass in an
  // iframe at the panel's exact resolution. The kiosk (loopback) and
  // the inner frame (?mirror=1) render the app directly.
  render(<NativeMirror />, root);
} else if (isEmbeddedPreview()) {
  // Designer preview running inside the designer's <iframe>. The iframe's
  // own viewport IS the panel, so every vh/vw/@media in the app resolves
  // correctly against the real panel size with no override. The
  // non-viewport profile (diagonal/touch/type scale, device-kind, preset)
  // arrives over the same-origin embed channel. embeddedInDisplayTest
  // reuses the designer theme-override wiring; the App writes its own
  // <html> theme because it is in an iframe (App.tsx: self !== top).
  render(
    <PresentationProvider>
      <EmbedProfileSync />
      <App embeddedInDisplayTest />
    </PresentationProvider>,
    root
  );
} else {
  render(
    <PresentationProvider>
      <App />
    </PresentationProvider>,
    root
  );
}

// Self-updating client: reload when the target serves a new bundle. Not
// in the designer / embedded-preview contexts - those are dev iframes
// where an auto-reload would be wrong.
if (!isDesignerMode() && !isEmbeddedPreview()) {
  startBundleUpdater();
}

/** True when this document is the designer's embedded preview iframe. */
function isEmbeddedPreview(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get("embedded") === "1";
}

/** True when this document should render the /native mirror wrapper:
 *  an explicit native entry from a NON-loopback origin, and not the
 *  wrapper's own inner frame (?mirror=1 - the recursion guard). The
 *  kiosk on loopback renders the app fullscreen directly. */
function isNativeMirror(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    scopeFromPath(window.location.pathname) === "native" &&
    !isLoopbackHost(window.location.hostname) &&
    new URLSearchParams(window.location.search).get("mirror") !== "1"
  );
}

/**
 * Pushes the designer's selected device profile (received over the
 * same-origin embed channel) into the embedded App's presentation
 * context. Sizing is NOT pushed - the iframe viewport already equals the
 * panel - only the non-viewport profile. Re-applies on every channel
 * change so the sliders/picker update the preview live.
 */
function EmbedProfileSync() {
  const {
    setProfileSettings,
    setDiagonalInches,
    setDeviceKindSetting,
    setPresetId
  } = usePresentation();
  useEffect(() => {
    const apply = (): void => {
      const profile = readEmbedProfile();
      if (profile === null) {
        return;
      }
      setProfileSettings(profile.profileSettings);
      setDiagonalInches(profile.diagonalInches);
      setDeviceKindSetting(profile.deviceKindSetting);
      setPresetId(profile.presetId);
    };
    apply();
    return onEmbedProfileChange(apply);
  }, [setProfileSettings, setDiagonalInches, setDeviceKindSetting, setPresetId]);
  return null;
}

/**
 * Resolve a bearer token from the URL `?bearer=...` query (one-time,
 * then stripped from the URL bar) or carry the value already stored
 * in `localStorage`. Vestigial path retained for external automation
 * systems that paste a bearer through a shared session; the
 * operator's own browser session under the canonical topology does
 * NOT use this — it admits via LAN-trust through the runtime's
 * reverse-proxy. Feature modules that opened a `WsTransport`
 * against an absolute framework URL historically may still read
 * the token here; new feature modules use relative URLs and rely
 * on the topology guarantee.
 */
function resolveBearerToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("bearer");
  if (fromQuery !== null && fromQuery.length > 0) {
    window.localStorage.setItem("evoBearer", fromQuery);
    const stripped = new URL(window.location.href);
    stripped.searchParams.delete("bearer");
    window.history.replaceState(null, "", stripped.toString());
  }
}

function registerServiceWorker(): void {
  // The service worker caches the app shell so the operator UI
  // continues to render the last-known state when the network drops.
  // Same-origin scope; only registers on https or localhost per
  // browser policy.
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
    return;
  }
  navigator.serviceWorker
    .register("/service-worker.js", { scope: "/" })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("service worker registration refused:", err);
    });
}
