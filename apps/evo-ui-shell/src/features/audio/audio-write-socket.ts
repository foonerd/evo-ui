// audio-write-socket - which socket a Settings > Audio write rides.
//
// The two Audio hooks (useAudioOptions, useHardwareAudio) each open a
// private anonymous seed socket for their reads and happenings. Every
// mixer / DSP / DAC write used to go out on that seed socket too. After
// this browser pairs, its step-up sitting is bound to bearer:<id>; a
// write that stays on the anonymous seed socket presents that sitting
// from the LAN-trust identity, the framework refuses it as another
// peer's (step_up_required), and the card comes up again for a
// password that can never satisfy.
//
// Same rule as the kiosk and household write sockets: with a stored
// bearer, writes ride a private socket that presents it (read at every
// handshake, rotated by the bearer bus, closed on unmount); without
// one, they stay on the seed socket. Reads and happenings stay on the
// seed socket either way, and the seed socket is never given a bearer
// - a stale bearer on the read path blacks a panel out.

export type AudioWriteSocket = "seed" | "stored-bearer";

export function audioWriteSocket(hasStoredBearer: boolean): AudioWriteSocket {
  return hasStoredBearer ? "stored-bearer" : "seed";
}

/** The hardware.audio verbs the plugin manifest gates as
 *  step_up:audio_admin - the shelf's mutating set (verified against
 *  org.evoframework.hardware.audio-config/manifest.toml,
 *  [capabilities.respondent.verb_capabilities]). Every other verb on
 *  the shelf is a read by that same manifest (list_dac_catalogue,
 *  current_config, confirm_reboot_required, verify_install,
 *  dsp.list_controls, dsp.get_control, modder.list_overlays) and stays
 *  on the seed socket. */
export const HARDWARE_AUDIO_WRITE_VERBS: ReadonlySet<string> = new Set([
  "hardware.audio.select_dac",
  "hardware.audio.clear_dac",
  "hardware.audio.dsp.set_control",
  "hardware.audio.modder.register_overlay",
  "hardware.audio.modder.remove_overlay"
]);

export function isHardwareAudioWrite(requestType: string): boolean {
  return HARDWARE_AUDIO_WRITE_VERBS.has(requestType);
}
