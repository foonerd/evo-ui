// DacOverlayManager - the custom-DAC overlay (modder) surface,
// rendered inside the DAC stage.
//
// Lists registered user overlays with their activation state and a
// remove control, and provides the register form: a .dtbo file
// upload (SHA-256 computed locally - the framework recomputes it and
// refuses on mismatch), the catalogue-row metadata, and the two-step
// CONFIRM:<id> token. register_overlay also needs an operator-signed
// allowlist on the device that already lists the file's hash; the
// surface states that plainly when one is absent and shows the hash
// so the operator can add it.

import { t } from "../../runtime/i18n";
import { useState } from "preact/hooks";
import { Cpu, HelpCircle, Trash2, Upload, X } from "lucide-preact";
import { sha256Hex } from "../../runtime/sha256";
import { EvoSelect } from "../../components/EvoSelect";
import {
  MODDER_INTERFACES,
  outputClassLabel,
  type ModderSurface,
  type OutputClass
} from "./audio-options-decoders";
import type {
  HardwareAudioResult,
  ModderRegisterInput
} from "./useHardwareAudio";

interface DacOverlayManagerProps {
  /** Modder surface state, or null before the first read. */
  surface: ModderSurface | null;
  /** Board profile a registered overlay row must declare. */
  boardProfile: string;
  /** True while a DAC gesture is in flight - locks the controls. */
  busy: boolean;
  onRegister: (input: ModderRegisterInput) => Promise<HardwareAudioResult>;
  onRemove: (id: string) => Promise<HardwareAudioResult>;
}

interface PickedFile {
  name: string;
  byteLength: number;
  bytes: number[];
  sha256: string;
}

export function DacOverlayManager({
  surface,
  boardProfile,
  busy,
  onRegister,
  onRemove
}: DacOverlayManagerProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [iface, setIface] = useState("i2s");
  const [overlay, setOverlay] = useState("");
  const [alsaCardHint, setAlsaCardHint] = useState("");
  const [inCardMixer, setInCardMixer] = useState("");
  const [dspOptions, setDspOptions] = useState("");
  const [overrideBase, setOverrideBase] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Modder state not read yet - the DAC stage is still seeding.
  if (surface === null) return null;

  const onFilePick = async (input: HTMLInputElement): Promise<void> => {
    setFileError(null);
    setFile(null);
    const picked = input.files?.[0];
    if (picked === undefined) return;
    try {
      const buf = await picked.arrayBuffer();
      const bytes = new Uint8Array(buf);
      setFile({
        name: picked.name,
        byteLength: bytes.length,
        bytes: Array.from(bytes),
        sha256: sha256Hex(bytes)
      });
    } catch (e) {
      setFileError(
        e instanceof Error ? e.message : t("modder.readFail")
      );
    }
  };

  const resetForm = (): void => {
    setFile(null);
    setFileError(null);
    setId("");
    setDisplayName("");
    setIface("i2s");
    setOverlay("");
    setAlsaCardHint("");
    setInCardMixer("");
    setDspOptions("");
    setOverrideBase(false);
    setConfirmId("");
    setRegisterError(null);
  };

  const trimmedId = id.trim();
  const confirmMatches = confirmId.trim() === trimmedId && trimmedId.length > 0;
  const canSubmit =
    file !== null &&
    trimmedId.length > 0 &&
    displayName.trim().length > 0 &&
    overlay.trim().length > 0 &&
    confirmMatches &&
    !submitting &&
    !busy;

  const onSubmit = async (): Promise<void> => {
    if (file === null || !canSubmit) return;
    setRegisterError(null);
    setRegistered(null);
    setSubmitting(true);
    const dsp = dspOptions
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const r = await onRegister({
      id: trimmedId,
      displayName: displayName.trim(),
      boardProfile,
      interface: iface,
      overlay: overlay.trim(),
      alsaCardHint: alsaCardHint.trim(),
      inCardMixer: inCardMixer.trim(),
      dspOptions: dsp,
      overrideBase,
      dtboBytes: file.bytes,
      dtboSha256: file.sha256,
      confirmationToken: `CONFIRM:${trimmedId}`
    });
    setSubmitting(false);
    if (r.ok) {
      setRegistered(`Registered "${displayName.trim()}".`);
      resetForm();
      setFormOpen(false);
    } else {
      setRegisterError(r.message);
    }
  };

  const onRemoveClick = async (overlayId: string): Promise<void> => {
    setRemoveError(null);
    setRemovingId(overlayId);
    const r = await onRemove(overlayId);
    setRemovingId(null);
    if (!r.ok) setRemoveError(r.message);
  };

  const overlays = surface.overlays;

  return (
    <div className="audio-modder">
      {!surface.surfaceEnabled ? (
        <p className="audio-stage-note">
          Custom DAC overlays are switched off on this build of the
          device. A vendor distribution can disable the modder surface.
        </p>
      ) : (
        <>
          {overlays.length === 0 ? (
            <p className="audio-stage-note">
              No custom DAC overlays are registered. Use the form below to
              add a DAC that is not in the built-in catalogue.
            </p>
          ) : (
            <ul className="audio-modder-list">
              {overlays.map((o) => (
                <li key={o.id} className="audio-modder-row">
                  <span className="audio-modder-ic" aria-hidden>
                    <Cpu size={15} />
                  </span>
                  <span className="audio-modder-text">
                    <strong>{o.displayName}</strong>
                    <span className="audio-modder-meta">
                      {o.id} - {outputClassLabel(o.interface as OutputClass)}
                      {o.state.kind === "refused"
                        ? ` - refused: ${o.state.reason}`
                        : ""}
                    </span>
                  </span>
                  <span
                    className={
                      o.state.kind === "active"
                        ? "audio-modder-state audio-modder-state-active"
                        : "audio-modder-state audio-modder-state-refused"
                    }
                  >
                    {o.state.kind === "active" ? t("modder.active") : t("modder.refused")}
                  </span>
                  <button
                    type="button"
                    className="audio-modder-remove"
                    aria-label={`Remove ${o.displayName}`}
                    title={t("modder.remove")}
                    disabled={busy || removingId !== null}
                    onClick={() => void onRemoveClick(o.id)}
                  >
                    {removingId === o.id ? (
                      <span className="audio-modder-removing">...</span>
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {removeError !== null ? (
            <div className="audio-options-setter-error" role="alert">
              <span>{removeError}</span>
            </div>
          ) : null}
          {registered !== null ? (
            <p className="audio-modder-ok" role="status">
              {registered}
            </p>
          ) : null}

          {formOpen ? (
            <div className="audio-modder-form">
              <div className="audio-modder-form-head">
                <span>{t("modder.registerTitle")}</span>
                <button
                  type="button"
                  className="audio-modder-form-close"
                  aria-label={t("dialog.close")}
                  title={t("dialog.close")}
                  onClick={() => {
                    resetForm();
                    setFormOpen(false);
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {!surface.allowlistLoaded ? (
                <p className="audio-modder-warn">
                  No signed overlay allowlist is installed on this device.
                  A register is refused until the file's hash is added to
                  /etc/evo/hardware/audio/overlays/allowlist.signed. The
                  hash below is what you add.
                </p>
              ) : null}
              <button
                type="button"
                className="audio-modder-help-link"
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle size={13} aria-hidden />
                <span>How do I prepare the allowlist?</span>
              </button>

              <label className="settings-label" htmlFor="modder-file">
                <span>Overlay file (.dtbo)</span>
                <input
                  id="modder-file"
                  type="file"
                  accept=".dtbo"
                  disabled={submitting || busy}
                  onChange={(ev) =>
                    void onFilePick(ev.currentTarget as HTMLInputElement)
                  }
                />
              </label>
              {fileError !== null ? (
                <p className="audio-options-hint-warning">{fileError}</p>
              ) : null}
              {file !== null ? (
                <p className="audio-modder-filehash">
                  <Upload size={12} aria-hidden /> {file.name} -{" "}
                  {file.byteLength} bytes - SHA-256 {file.sha256}
                </p>
              ) : null}

              <label className="settings-label" htmlFor="modder-id">
                <span>{t("modder.catalogueId")}</span>
                <input
                  id="modder-id"
                  type="text"
                  value={id}
                  placeholder="my-custom-dac"
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setId((ev.currentTarget as HTMLInputElement).value)
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-name">
                <span>{t("modder.displayName")}</span>
                <input
                  id="modder-name"
                  type="text"
                  value={displayName}
                  placeholder="My Custom DAC"
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setDisplayName(
                      (ev.currentTarget as HTMLInputElement).value
                    )
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-iface">
                <span>Interface</span>
                <EvoSelect
                  ariaLabel="Interface"
                  value={iface}
                  disabled={submitting || busy}
                  options={MODDER_INTERFACES.map((v) => ({
                    value: v,
                    label: outputClassLabel(v as OutputClass)
                  }))}
                  onChange={setIface}
                />
              </label>
              <label className="settings-label" htmlFor="modder-overlay">
                <span>dtoverlay token</span>
                <input
                  id="modder-overlay"
                  type="text"
                  value={overlay}
                  placeholder="my-custom-dac"
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setOverlay((ev.currentTarget as HTMLInputElement).value)
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-card">
                <span>ALSA card hint (optional)</span>
                <input
                  id="modder-card"
                  type="text"
                  value={alsaCardHint}
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setAlsaCardHint(
                      (ev.currentTarget as HTMLInputElement).value
                    )
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-mixer">
                <span>In-card mixer (optional)</span>
                <input
                  id="modder-mixer"
                  type="text"
                  value={inCardMixer}
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setInCardMixer(
                      (ev.currentTarget as HTMLInputElement).value
                    )
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-dsp">
                <span>DSP options (optional, comma-separated)</span>
                <input
                  id="modder-dsp"
                  type="text"
                  value={dspOptions}
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setDspOptions(
                      (ev.currentTarget as HTMLInputElement).value
                    )
                  }
                />
              </label>
              <label className="settings-label" htmlFor="modder-override">
                <span>Override a built-in DAC of the same id</span>
                <input
                  id="modder-override"
                  type="checkbox"
                  className="audio-toggle"
                  checked={overrideBase}
                  disabled={submitting || busy}
                  onChange={(ev) =>
                    setOverrideBase(
                      (ev.currentTarget as HTMLInputElement).checked
                    )
                  }
                />
              </label>

              <label className="settings-label" htmlFor="modder-confirm">
                <span>Confirm: re-type the catalogue id</span>
                <input
                  id="modder-confirm"
                  type="text"
                  value={confirmId}
                  disabled={submitting || busy}
                  onInput={(ev) =>
                    setConfirmId(
                      (ev.currentTarget as HTMLInputElement).value
                    )
                  }
                />
              </label>
              {confirmId.trim().length > 0 && !confirmMatches ? (
                <p className="audio-options-hint-warning">
                  The confirmation does not match the catalogue id.
                </p>
              ) : null}

              {registerError !== null ? (
                <div className="audio-options-setter-error" role="alert">
                  <span>{registerError}</span>
                </div>
              ) : null}

              <div className="audio-modder-actions">
                <button
                  type="button"
                  className="audio-modder-register"
                  disabled={!canSubmit}
                  onClick={() => void onSubmit()}
                >
                  {submitting ? t("modder.registering") : t("modder.registerOverlay")}
                </button>
              </div>
            </div>
          ) : (
            <div className="audio-modder-actions">
              <button
                type="button"
                className="audio-modder-open"
                disabled={busy}
                onClick={() => {
                  setRegistered(null);
                  setFormOpen(true);
                }}
              >
                <Upload size={14} />
                <span>{t("modder.registerTitle")}</span>
              </button>
            </div>
          )}
        </>
      )}

      {helpOpen ? (
        <div
          className="audio-modder-help-root"
          role="dialog"
          aria-modal="true"
          aria-label={t("modder.helpTitle")}
        >
          <div className="audio-modder-help-card">
            <div className="audio-modder-help-head">
              <span>{t("modder.helpTitle")}</span>
              <button
                type="button"
                className="audio-modder-form-close"
                aria-label="Close"
                title="Close"
                onClick={() => setHelpOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <p>
              A custom DAC overlay is accepted only when the .dtbo
              file's SHA-256 is listed in a signed allowlist on the
              device. This keeps an unverified overlay out of the boot
              configuration.
            </p>
            <p>
              The allowlist is a JSON file at
              /etc/evo/hardware/audio/overlays/allowlist.signed:
            </p>
            <pre className="audio-modder-help-pre">{`{
  "schema_version": 1,
  "signing_key_hex": "<Ed25519 public key, 64 hex chars>",
  "entries": [
    {
      "dtbo_sha256_hex": "<the .dtbo file hash>",
      "display_name": "My Custom DAC overlay",
      "issued_at_ms": 1716240000000
    }
  ],
  "signature_hex": "<Ed25519 signature, hex>"
}`}</pre>
            <ol className="audio-modder-help-steps">
              <li>
                Pick the .dtbo file in the register form - this panel
                shows its SHA-256.
              </li>
              <li>
                Add an entry to the allowlist whose dtbo_sha256_hex is
                that hash.
              </li>
              <li>
                Sign the document: take an Ed25519 signature over the
                canonical JSON of the file with signature_hex removed,
                put that hex signature in signature_hex and your public
                key hex in signing_key_hex.
              </li>
              <li>
                Place the signed file at the path above on the device.
              </li>
              <li>Register the overlay here.</li>
            </ol>
            <p className="audio-modder-help-note">
              Signing is done offline with your Ed25519 key - the UI
              cannot sign the allowlist for you.
            </p>
            <div className="audio-modder-help-actions">
              <button type="button" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
