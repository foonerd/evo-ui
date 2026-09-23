// Contract: the reboot reminder must follow the player.
//
// Field failure: useHardwareAudio started pendingReboot = false and
// only ever set it from a select_dac / clear_dac outcome, so after a
// reload the glass forgot a reboot the player still holds. Its
// confirmReboot dispatched confirm_reboot_required - a READ of the
// plugin's flag (handle_confirm_reboot_required only reads
// pending_reboot) - and treated any ok as setPendingReboot(false), so
// Later / Got it / the 15 s auto-dismiss all pretended the player had
// cleared a flag it still holds. Now the flag is read on the seed
// socket at seed and on every re-read and seeds from the body's
// pending_reboot; a read landing never clears it by itself; Later /
// Got it / the timer are a local dismiss keyed to the player's
// set_at_ms, so a fresh select / clear raises the reminder again; no
// Framework confirm verb exists or is invented; the write-socket pick
// from the previous row is untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodePendingReboot } from "../../src/features/audio/audio-options-decoders.ts";
import { rebootReminderDue } from "../../src/features/audio/reboot-reminder.ts";
import {
  audioWriteSocket,
  isHardwareAudioWrite,
  HARDWARE_AUDIO_WRITE_VERBS
} from "../../src/features/audio/audio-write-socket.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/audio/useHardwareAudio.ts");
const panel = src("features/audio/AudioOptionsPanel.tsx");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

// The live body of hardware.audio.confirm_reboot_required
// (lib.rs handle_confirm_reboot_required): { v, pending_reboot:
// PendingRebootState { pending, cause, set_at_ms } }.
const held = {
  v: 1,
  pending_reboot: { pending: true, cause: "select_dac board-a", set_at_ms: 1757800000000 }
};
const clear = { v: 1, pending_reboot: { pending: false, cause: "", set_at_ms: 0 } };

test("pendingReboot seeds from the player's pending_reboot", () => {
  assert.deepEqual(decodePendingReboot(held), {
    pending: true,
    cause: "select_dac board-a",
    setAtMs: 1757800000000
  });
  assert.deepEqual(decodePendingReboot(clear), { pending: false, cause: "", setAtMs: 0 });
  // The pending_reboot subject state is the bare struct: same decode.
  assert.equal(decodePendingReboot(held.pending_reboot)?.pending, true);
  // Absent optionals degrade, the flag does not.
  assert.deepEqual(decodePendingReboot({ v: 1, pending_reboot: { pending: true } }), {
    pending: true,
    cause: "",
    setAtMs: 0
  });

  // The hook reads it where every other hardware.audio read lives, on
  // the seed socket, and seeds the flag from the body.
  const refresh = between(hook, "const refreshState = useCallback", "useEffect(() => {");
  assert.ok(
    /pluginRequest\(\s*transport,\s*SHELF,\s*"hardware\.audio\.confirm_reboot_required",\s*\{ v: PAYLOAD_VERSION \}\s*\)/.test(refresh),
    "confirm_reboot_required is read in refreshState on the seed socket"
  );
  assert.ok(
    /const decoded = decodePendingReboot\(reboot\.value\);\s*if \(decoded !== null\) \{\s*setPendingReboot\(decoded\.pending\);\s*setPendingRebootSince\(decoded\.setAtMs\);/.test(refresh),
    "the flag and its generation come from the body"
  );
  // Seed calls refreshState; a reload therefore seeds the reminder.
  const seed = between(hook, "const seed = async (): Promise<void> => {", "const handleHappening");
  assert.ok(/await refreshState\(transport\);/.test(seed), "seed re-reads through refreshState");
  assert.ok(/const \[pendingReboot, setPendingReboot\] = useState\(false\);/.test(hook), "no fabricated true before the read");
  assert.ok(/pendingRebootSince: number;/.test(hook), "the player's set_at_ms is exposed for the local dismiss");
});

test("a successful confirm_reboot_required whose body still says true does not clear the hook's flag", () => {
  // The body decides: true stays true.
  assert.equal(decodePendingReboot(held)?.pending, true);
  // An unreadable body is not a clear either.
  assert.equal(decodePendingReboot({ v: 1, pending_reboot: {} }), null);
  assert.equal(decodePendingReboot({ v: 1, pending_reboot: { pending: "yes" } }), null);
  assert.equal(decodePendingReboot({ v: 1 }), null);
  assert.equal(decodePendingReboot(null), null);
  assert.equal(decodePendingReboot([]), null);

  // Nothing in the hook sets the flag false on its own account: the
  // only false ever written is the player's.
  assert.ok(!/setPendingReboot\(false\)/.test(hook), "no setPendingReboot(false) anywhere");
  const sets = hook.match(/setPendingReboot\(([^)]*)\)/g) ?? [];
  for (const s of sets) {
    assert.ok(
      s === "setPendingReboot(decoded.pending)" || s === "setPendingReboot(true)",
      `${s}: the flag is set from the body, or true from a select / clear outcome`
    );
  }
  assert.ok(sets.includes("setPendingReboot(decoded.pending)"));
  // The read landing is not the signal - the decoded body is.
  const refresh = between(hook, "const refreshState = useCallback", "useEffect(() => {");
  assert.ok(/if \(reboot\.error === undefined\) \{\s*const decoded = decodePendingReboot\(reboot\.value\);\s*if \(decoded !== null\)/.test(refresh));
  // The confirm-as-clear lie is gone from the hook's surface.
  assert.ok(!/confirmReboot/.test(hook), "no confirmReboot on the hook");
  // No Framework confirm verb exists or is invented.
  assert.ok(!/clear_pending_reboot|ack_reboot|acknowledge_reboot|confirm_reboot"|reboot_confirmed/.test(hook));
  const verbs = [...hook.matchAll(/"hardware\.audio\.[a-z_.]+"/g)].map((m) => m[0]).sort();
  assert.deepEqual(
    [...new Set(verbs)],
    [
      '"hardware.audio.clear_dac"',
      '"hardware.audio.confirm_reboot_required"',
      '"hardware.audio.current_config"',
      '"hardware.audio.dsp.list_controls"',
      '"hardware.audio.dsp.set_control"',
      '"hardware.audio.list_dac_catalogue"',
      '"hardware.audio.modder.list_overlays"',
      '"hardware.audio.modder.register_overlay"',
      '"hardware.audio.modder.remove_overlay"',
      '"hardware.audio.select_dac"'
    ],
    "the same verbs as before, no new one"
  );
});

test("Later is a local dismiss", () => {
  // The pure decision: the player's flag, minus a dismissal of THIS
  // pending state. A fresh select / clear (new set_at_ms) is due again.
  assert.equal(rebootReminderDue({ pending: false, since: 0, dismissedSince: null }), false);
  assert.equal(rebootReminderDue({ pending: true, since: 10, dismissedSince: null }), true);
  assert.equal(rebootReminderDue({ pending: true, since: 10, dismissedSince: 10 }), false);
  assert.equal(rebootReminderDue({ pending: true, since: 11, dismissedSince: 10 }), true);
  assert.equal(rebootReminderDue({ pending: false, since: 0, dismissedSince: 10 }), false);

  // The panel: Later / Got it and the 15 s timer dismiss locally;
  // nothing is sent to the player.
  assert.ok(!/confirmReboot/.test(panel), "the panel no longer calls confirmReboot");
  assert.ok(
    /const dismissRebootReminder = useCallback\(\(\): void => \{\s*setRebootDismissedSince\(hw\.pendingRebootSince\);\s*\}, \[hw\.pendingRebootSince\]\);/.test(panel),
    "the dismiss records the player's generation locally, and follows it"
  );
  assert.ok(
    /\}, \[rebootReminderDueNow, rebootBusy, dismissRebootReminder\]\);/.test(panel),
    "a fresh flip while the reminder is up restarts the countdown"
  );
  assert.ok(/onClick=\{dismissRebootReminder\}/.test(panel), "Later / Got it is the local dismiss");
  const countdown = between(panel, "// Reboot modal:", "// Clear the reboot dispatch state");
  assert.ok(/if \(left <= 0\) \{\s*window\.clearInterval\(h\);\s*setRebootCountdown\(0\);\s*dismissRebootReminder\(\);/.test(countdown),
    "the timer is the same local dismiss");
  assert.ok(!/hw\.(selectDac|clearDac|setDspControl|registerOverlay|removeOverlay)|pluginRequest|dispatch\(/.test(countdown),
    "the timer sends nothing");
  assert.ok(
    /const rebootReminderDueNow = rebootReminderDue\(\{\s*pending: hw\.pendingReboot,\s*since: hw\.pendingRebootSince,\s*dismissedSince: rebootDismissedSince\s*\}\);/.test(panel),
    "the panel decides through the pure function"
  );
  assert.ok(/\{rebootReminderDueNow && transitionPhase\.kind !== "failed" \? \(/.test(panel), "the failed modal still takes precedence");
  assert.ok(/if \(!rebootReminderDueNow \|\| rebootBusy\) \{/.test(countdown), "the countdown runs only while the reminder is shown");
  assert.ok(!/setPendingReboot/.test(panel), "the panel never writes the player's flag");
});

test("the write-socket pick is unchanged", () => {
  assert.equal(audioWriteSocket(true), "stored-bearer");
  assert.equal(audioWriteSocket(false), "seed");
  const pick = between(hook, "const writeTransport = useCallback", "const dispatch = useCallback");
  assert.ok(
    /if \(audioWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return transportRef\.current;\s*\}/.test(pick)
  );
  assert.ok(/new WsTransport\(\{ url: frameworkUrl\(\), bearerSource: storedBearer \}\)/.test(pick));
  assert.ok(!/\?\? transportRef\.current/.test(pick));
  const dispatch = between(hook, "const dispatch = useCallback", "const selectDac = useCallback");
  assert.ok(/const transport = isHardwareAudioWrite\(requestType\)\s*\? writeTransport\(\)\s*: transportRef\.current;/.test(dispatch));
  assert.equal(HARDWARE_AUDIO_WRITE_VERBS.size, 5);
  assert.equal(isHardwareAudioWrite("hardware.audio.confirm_reboot_required"), false, "still a read, still the seed socket");
  assert.ok(/const transport = new WsTransport\(\{ url: frameworkUrl\(\) \}\);/.test(hook), "seed socket still anonymous");
  assert.equal((hook.match(/bearerSource/g) ?? []).length, 1);
});
