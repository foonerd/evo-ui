// Probe hygiene (ruled 2026-07-14 after a menu-editor probe left
// "power: hidden" curation on a real panel): every probe that can
// WRITE device settings must snapshot them first and restore them
// after, pass or fail. Use:
//
//   import { snapshotSettings, restoreSettings } from "./probe-lib.mjs";
//   const snap = await snapshotSettings(BASE, ["ui.profile", "ui.theme"]);
//   try { ...drive the designer... }
//   finally { await restoreSettings(BASE, snap); }
//
// Restore writes back the EXACT captured values for the listed keys
// (missing-at-snapshot keys are skipped - the runtime cannot delete
// keys, so probes must not create new ones they cannot remove).

export async function snapshotSettings(base, keys) {
  const r = await fetch(`${base}/api/ui/v1/settings`);
  const payload = await r.json();
  const values = {};
  for (const k of keys) {
    if (k in payload.settings) values[k] = payload.settings[k];
  }
  return { base, keys, values };
}

export async function restoreSettings(base, snap) {
  const changes = {};
  let dirty = false;
  const current = await (await fetch(`${base}/api/ui/v1/settings`)).json();
  for (const k of snap.keys) {
    if (!(k in snap.values)) continue; // did not exist - cannot delete, skip
    if (JSON.stringify(current.settings[k]) !== JSON.stringify(snap.values[k])) {
      changes[k] = snap.values[k];
      dirty = true;
    }
  }
  if (!dirty) return { restored: false };
  const res = await fetch(`${base}/api/ui/v1/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes, revision: current.revision }),
  });
  if (!res.ok) throw new Error(`restore failed: ${res.status}`);
  return { restored: true, keys: Object.keys(changes) };
}
