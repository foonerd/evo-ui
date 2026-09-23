// reboot-reminder - whether the Audio panel shows the reboot reminder.
//
// The player owns the reboot-required flag (hardware.audio
// confirm_reboot_required, held in the plugin's memory until the host
// reboots). The panel may hide the reminder for this session after
// Later / Got it / the 15 s timer, but that is a local dismissal of
// THIS pending state - keyed to the player's set_at_ms - never a
// clear. A fresh select / clear flips the flag again with a new
// timestamp, and the reminder is due again; once the host has
// rebooted the player reports pending = false and nothing is due.

export interface RebootReminderInput {
  /** The player's pending_reboot.pending, as last read. */
  pending: boolean;
  /** The player's pending_reboot.set_at_ms (0 when none / not
   *  reported). */
  since: number;
  /** The `since` the operator dismissed in this session, or null. */
  dismissedSince: number | null;
}

export function rebootReminderDue(input: RebootReminderInput): boolean {
  if (!input.pending) return false;
  return input.dismissedSince !== input.since;
}
