// Self-updating client.
//
// The served bundle is the single source of truth. This document loaded
// one specific `index-<hash>.js`; the runtime serves index.html with
// `cache-control: no-store`, so a cheap fetch of `/` always reflects the
// bundle the target serves RIGHT NOW. When that differs from what we
// loaded, the deployed UI has changed underneath us and this document is
// stale - so we reload, gated on operator idleness so an actively-used
// surface is never yanked out from under the operator.
//
// Why this and not a deploy-time push: a deploy script that bounces the
// kiosk only refreshes freshness when every deployer uses that one script
// every time. That is a discipline requirement, not a property. Watching
// the served bundle inverts the trust model correctly - the client stops
// trusting stale state, so NO deploy path (the canonical deploy, a raw
// rsync + symlink flip, a bundle that arrived while this kiosk was
// offline) can leave a stale wedge behind. Same shape as the runtime's
// CA hot-reload watcher: converge to what is on disk, do not trust a
// snapshot indefinitely.
//
// Failure semantics are explicit: if the served bundle cannot be read
// (network blip, runtime mid-restart), we keep the current bundle and
// retry on the next cycle - never blank, never hard-fail over a freshness
// check.

const CHECK_INTERVAL_MS = 20_000;
/** Reload only once the operator has been idle this long, so an active
 *  interaction is never interrupted. A kiosk (no input) reloads promptly. */
const IDLE_BEFORE_RELOAD_MS = 4_000;
/** While the operator is busy, re-check idleness this often. */
const RECHECK_WHILE_BUSY_MS = 2_000;

/** Extract the `index-<hash>.js` bundle id from a script src or an
 *  index.html body. Exported for testing. Returns null when absent. */
export function parseBundleId(text: string): string | null {
  const m = text.match(/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

function loadedBundleId(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLScriptElement>(
    'script[src*="/assets/index-"]'
  );
  return el ? parseBundleId(el.src) : null;
}

async function servedBundleId(): Promise<string | null> {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return null;
    return parseBundleId(await res.text());
  } catch {
    // Runtime mid-restart / transient network: keep the current bundle.
    return null;
  }
}

/**
 * Start watching the served bundle and reload this document when it
 * changes. Returns a stop function (tests / teardown). No-op in a
 * non-browser context or when this document's own bundle id can't be
 * identified (nothing to compare against).
 */
export function startBundleUpdater(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const loaded = loadedBundleId();
  if (loaded === null) {
    return () => {};
  }

  let stopped = false;
  let lastInputMs = Date.now();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const markInput = (): void => {
    lastInputMs = Date.now();
  };
  window.addEventListener("pointerdown", markInput, { passive: true });
  window.addEventListener("keydown", markInput, { passive: true });

  const armReloadWhenIdle = (): void => {
    if (reloadTimer !== null) return; // already armed
    const attempt = (): void => {
      if (stopped) return;
      const idle = Date.now() - lastInputMs >= IDLE_BEFORE_RELOAD_MS;
      if (idle || document.hidden) {
        window.location.reload();
      } else {
        reloadTimer = setTimeout(attempt, RECHECK_WHILE_BUSY_MS);
      }
    };
    reloadTimer = setTimeout(attempt, 0);
  };

  const check = async (): Promise<void> => {
    if (stopped) return;
    const served = await servedBundleId();
    if (served !== null && served !== loaded) {
      armReloadWhenIdle();
    }
  };

  const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  const onVisible = (): void => {
    if (!document.hidden) void check();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  void check();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    if (reloadTimer !== null) window.clearTimeout(reloadTimer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("pointerdown", markInput);
    window.removeEventListener("keydown", markInput);
  };
}
