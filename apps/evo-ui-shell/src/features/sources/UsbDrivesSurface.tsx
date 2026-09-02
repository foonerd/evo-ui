// UsbDrivesSurface - the device's own USB drives, on the Sources page
// (new section under SMB / NAS). Binds the storage_usb_drives subject and
// the four storage.usb verbs. Normative contract:
// plugins/org.evoframework.storage.usb/docs/USB-STORAGE.md section 10.
//
// Rules honoured here: every role renders (system-* informationally in a
// collapsed read-only section - NEVER filtered out, boot-drive-inventoried
// invariant); per-class affordance matrix; rename with live sanitise +
// UNC preview + playback-stop confirm; force-remove only on Busy with the
// holders verbatim; repair-escalate only after a first RepairFailed; the
// oversized / hiberfile / unsupported copy strings.

import { useState } from "preact/hooks";
import { Fragment } from "preact";
import type { JSX } from "preact";
import { ConfirmDialog, Modal } from "../../components/dialogs";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { reauthPromptResponder } from "../prompts/usePromptResponder";
import { friendlyVerbError } from "./friendly-error";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useUsbDrives, type UsbVerbResult } from "./useUsbDrives";
import type {
  UsbDrive,
  UsbDriveClass,
  UsbIdSource
} from "./usb-drives-decoders";

// Server-side enforced token (USB-STORAGE.md section 3); applied live so
// submit disables on invalid input.
const RENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  const s = i === 0 || v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${s} ${units[i]}`;
}

function fsLabel(fs: string): string {
  switch (fs) {
    case "vfat":
      return "FAT32";
    case "exfat":
      return "exFAT";
    case "ntfs":
      return "NTFS";
    default:
      return fs.toUpperCase();
  }
}

function idSourceHint(src: UsbIdSource | null): string | null {
  switch (src) {
    case "operator_alias":
      return t("usb.idsource.operator_alias");
    case "fs_label":
      return t("usb.idsource.fs_label");
    case "vendor_model":
      return t("usb.idsource.vendor_model");
    case "model_only":
      return t("usb.idsource.model_only");
    case "synthesized":
      return t("usb.idsource.synthesized");
    default:
      return null;
  }
}

interface Affordance {
  rename: boolean;
  saferemove: boolean;
  repair: boolean;
  mount: boolean;
  notice: "oversized" | "hiberfile" | "unsupported" | null;
}

function affordances(cls: UsbDriveClass): Affordance {
  switch (cls) {
    case "mounted-clean":
      return { rename: true, saferemove: true, repair: false, mount: false, notice: null };
    case "mounted-dirty":
      return { rename: true, saferemove: true, repair: true, mount: false, notice: null };
    case "mounted-dirty-hiberfile":
      return { rename: true, saferemove: true, repair: false, mount: false, notice: "hiberfile" };
    case "mount-failed-dirty":
      return { rename: true, saferemove: false, repair: true, mount: false, notice: null };
    case "mount-failed-oversized-vfat":
      return { rename: false, saferemove: false, repair: false, mount: false, notice: "oversized" };
    case "unsupported":
      return { rename: false, saferemove: false, repair: false, mount: false, notice: "unsupported" };
    case "unmounted":
      return { rename: true, saferemove: false, repair: false, mount: true, notice: null };
    case "mount-failed-other":
      return { rename: true, saferemove: false, repair: false, mount: true, notice: null };
    case "system-disk":
    default:
      return { rename: false, saferemove: false, repair: false, mount: false, notice: null };
  }
}

function isAuthRefusal(r: { subclass: string | null; message: string }): boolean {
  const s = (r.subclass ?? "").toLowerCase();
  if (/step.?up|pair|unauthor|forbidden|denied|scope/.test(s)) return true;
  return /pair (again|this device)|step.?up|not paired|unauthor|forbidden/i.test(r.message);
}

function hostForPreview(): string {
  if (typeof window === "undefined") return "device";
  return window.location.hostname || "device";
}

type UsbModal =
  | { kind: "force"; drive: UsbDrive; holders: string[] }
  | { kind: "repair-confirm"; drive: UsbDrive }
  | { kind: "repair-escalate"; drive: UsbDrive }
  | { kind: "rename-confirm"; drive: UsbDrive; alias: string }
  | { kind: "copy"; notice: "oversized" | "hiberfile" | "unsupported"; drive: UsbDrive };

export function UsbDrivesSurface(): JSX.Element {
  useLocale();
  const usb = useUsbDrives();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRefused, setAuthRefused] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [modal, setModal] = useState<UsbModal | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const onPaired = (): void => {
    setAuthRefused(false);
    setPairOpen(false);
    usb.reauth();
    reauthPromptResponder();
  };

  const run = async (
    fn: () => Promise<UsbVerbResult>,
    drive: UsbDrive,
    ctx: "mount" | "saferemove" | "repair" | "rename"
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const r = await fn();
    setBusy(false);
    if (r.ok) return;
    if (isAuthRefusal(r)) {
      setAuthRefused(true);
      return;
    }
    const probe = `${r.subclass ?? ""} ${r.message}`.toLowerCase();
    if (ctx === "saferemove" && /busy|still open|holders/.test(probe)) {
      setModal({ kind: "force", drive, holders: r.data.holders });
      return;
    }
    if (ctx === "repair" && /repair.?fail/.test(probe)) {
      setModal({ kind: "repair-escalate", drive });
      return;
    }
    if (/oversiz|2 ?tb|fat32.*(limit|larger)/.test(probe)) {
      setModal({ kind: "copy", notice: "oversized", drive });
      return;
    }
    if (/collide|another drive|name conflict/.test(probe)) {
      setFeedback(t("usb.err.collide"));
      return;
    }
    setFeedback(friendlyVerbError(r.message));
  };

  const openRename = (drive: UsbDrive): void => {
    setRenameFor(drive.stableId);
    setRenameDraft(drive.aliasSet ? drive.displayName : "");
    setFeedback("");
  };

  const submitRename = (drive: UsbDrive): void => {
    const alias = renameDraft.trim();
    if (alias.length > 0 && !RENAME_RE.test(alias)) return;
    if (drive.librarySourceId !== null) {
      setModal({ kind: "rename-confirm", drive, alias });
    } else {
      void doRename(drive, alias);
    }
  };

  const doRename = async (drive: UsbDrive, alias: string): Promise<void> => {
    setRenameFor(null);
    await run(() => usb.rename(drive.stableId, alias), drive, "rename");
  };

  const renameValid =
    renameDraft.trim().length === 0 || RENAME_RE.test(renameDraft.trim());

  const drives = usb.drives;
  const managed = (drives ?? []).filter((d) => d.driveClass !== "system-disk");
  const systemDrives = (drives ?? []).filter((d) => d.driveClass === "system-disk");
  const showAuthNotice = authRefused;

  const renderRow = (drive: UsbDrive, system: boolean): JSX.Element => {
    const aff = affordances(drive.driveClass);
    const secondaryBits: string[] = [];
    const vm = [drive.vendor, drive.model].filter((x) => x !== null).join(" ");
    if (vm.length > 0) secondaryBits.push(vm);
    if (drive.sizeBytes > 0) secondaryBits.push(formatSize(drive.sizeBytes));
    secondaryBits.push(fsLabel(drive.fsType));
    const hint = idSourceHint(drive.idSource);
    const renaming = renameFor === drive.stableId;

    return (
      <div className="usb-row" key={drive.stableId}>
        <span className="usb-row-art" aria-hidden>
          {system ? "\u{1F5A5}" : "\u{1F4BE}"}
        </span>
        <div className="usb-row-body">
          <p className="usb-row-name" title={hint ?? undefined}>
            {drive.displayName}
            {drive.partitionCount > 1 ? (
              <span className="usb-row-sub">
                {" "}
                {t("usb.partition", {
                  n: drive.partitionIndex,
                  m: drive.partitionCount
                })}
              </span>
            ) : null}
          </p>
          <p className="usb-row-meta">{secondaryBits.join(" · ")}</p>

          {aff.notice === "hiberfile" ? (
            <p className="usb-row-notice">{t("usb.copy.hiberfile")}</p>
          ) : null}
          {aff.notice === "oversized" ? (
            <p className="usb-row-notice">
              {t("usb.copy.oversizedShort", { size: formatSize(drive.sizeBytes) })}
            </p>
          ) : null}
          {aff.notice === "unsupported" ? (
            <p className="usb-row-notice">
              {t("usb.copy.unsupported", { fs: fsLabel(drive.fsType) })}
            </p>
          ) : null}

          {renaming ? (
            <div className="usb-rename">
              <input
                className="usb-rename-input"
                type="text"
                value={renameDraft}
                maxLength={32}
                placeholder={t("usb.rename.placeholder")}
                aria-label={t("usb.rename.label")}
                onInput={(e) =>
                  setRenameDraft((e.target as HTMLInputElement).value)
                }
              />
              <p className="usb-rename-preview">
                {renameDraft.trim().length === 0
                  ? t("usb.rename.resetHint")
                  : `\\\\${hostForPreview()}\\USB\\${renameDraft.trim()}`}
              </p>
              {!renameValid ? (
                <p className="usb-rename-invalid">{t("usb.rename.invalid")}</p>
              ) : null}
              <div className="usb-row-actions">
                <button
                  type="button"
                  className="usb-btn usb-btn-primary"
                  disabled={busy || !renameValid}
                  onClick={() => submitRename(drive)}
                >
                  {renameDraft.trim().length === 0
                    ? t("usb.action.reset")
                    : t("usb.action.save")}
                </button>
                <button
                  type="button"
                  className="usb-btn"
                  onClick={() => setRenameFor(null)}
                >
                  {t("dialog.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="usb-row-actions">
              {aff.mount ? (
                <button
                  type="button"
                  className="usb-btn"
                  disabled={busy}
                  onClick={() => void run(() => usb.mount(drive.stableId), drive, "mount")}
                >
                  {t("usb.action.mount")}
                </button>
              ) : null}
              {aff.repair ? (
                <button
                  type="button"
                  className="usb-btn"
                  disabled={busy}
                  onClick={() => setModal({ kind: "repair-confirm", drive })}
                >
                  {t("usb.action.repair")}
                </button>
              ) : null}
              {aff.rename ? (
                <button
                  type="button"
                  className="usb-btn"
                  disabled={busy}
                  onClick={() => openRename(drive)}
                >
                  {t("usb.action.rename")}
                </button>
              ) : null}
              {aff.saferemove ? (
                <button
                  type="button"
                  className="usb-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() => usb.safeRemove(drive.stableId), drive, "saferemove")
                  }
                >
                  {t("usb.action.saferemove")}
                </button>
              ) : null}
              {aff.notice !== null ? (
                <button
                  type="button"
                  className="usb-btn usb-btn-info"
                  onClick={() =>
                    setModal({ kind: "copy", notice: aff.notice!, drive })
                  }
                >
                  {t("usb.action.why")}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <section className="card feature-surface usb-surface">
        <div className="feature-head">
          <div>
            <h3>{t("usb.title")}</h3>
            <p className="feature-description">{t("usb.description")}</p>
          </div>
        </div>

        {showAuthNotice ? (
          <div className="net-notice">
            <span>{t("usb.pairNotice")}</span>
            <button
              type="button"
              className="settings-link-button"
              onClick={() => setPairOpen(true)}
            >
              {t("usb.pairAction")}
            </button>
          </div>
        ) : null}

        {feedback.length > 0 ? (
          <p className="sources-feedback" role="alert">
            {feedback}
          </p>
        ) : null}

        {drives === null ? (
          <p className="sources-empty">
            {usb.connection.kind === "error"
              ? (usb.connection.reason ?? t("sources.refused"))
              : usb.connection.kind === "disconnected"
                ? (usb.connection.reason ?? t("sources.notConnected"))
                : t("collection.loading")}
          </p>
        ) : managed.length === 0 && systemDrives.length === 0 ? (
          <p className="sources-empty">{t("usb.empty")}</p>
        ) : (
          <Fragment>
            {managed.length === 0 ? (
              <p className="sources-empty">{t("usb.emptyRemovable")}</p>
            ) : (
              <div className="usb-list">{managed.map((d) => renderRow(d, false))}</div>
            )}

            {systemDrives.length > 0 ? (
              <div className="usb-system">
                <button
                  type="button"
                  className="usb-system-toggle"
                  aria-expanded={systemOpen}
                  onClick={() => setSystemOpen((v) => !v)}
                >
                  {t("usb.section.system", { n: systemDrives.length })}
                  <span aria-hidden>{systemOpen ? " –" : " +"}</span>
                </button>
                {systemOpen ? (
                  <div className="usb-list usb-list-system">
                    {systemDrives.map((d) => renderRow(d, true))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Fragment>
        )}
      </section>

      {modal !== null && modal.kind === "repair-confirm" ? (
        <ConfirmDialog
          title={t("usb.confirm.repairTitle")}
          message={t("usb.confirm.repair", { name: modal.drive.displayName })}
          confirmLabel={t("usb.action.repair")}
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const d = modal.drive;
            setModal(null);
            void run(() => usb.repair(d.stableId), d, "repair");
          }}
        />
      ) : null}

      {modal !== null && modal.kind === "repair-escalate" ? (
        <ConfirmDialog
          title={t("usb.confirm.escalateTitle")}
          message={t("usb.confirm.escalate", { name: modal.drive.displayName })}
          confirmLabel={t("usb.action.tryharder")}
          destructive
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const d = modal.drive;
            setModal(null);
            void run(() => usb.repair(d.stableId, true), d, "repair");
          }}
        />
      ) : null}

      {modal !== null && modal.kind === "rename-confirm" ? (
        <ConfirmDialog
          title={t("usb.confirm.renameTitle")}
          message={t("usb.confirm.rename")}
          confirmLabel={t("usb.action.rename")}
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const { drive, alias } = modal;
            setModal(null);
            void doRename(drive, alias);
          }}
        />
      ) : null}

      {modal !== null && modal.kind === "force" ? (
        <ConfirmDialog
          title={t("usb.force.title")}
          message={
            modal.holders.length > 0
              ? t("usb.force.messageHolders", { holders: modal.holders.join(", ") })
              : t("usb.force.message")
          }
          confirmLabel={t("usb.action.forceremove")}
          destructive
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const d = modal.drive;
            setModal(null);
            void run(() => usb.safeRemove(d.stableId, true), d, "saferemove");
          }}
        />
      ) : null}

      {modal !== null && modal.kind === "copy" ? (
        <Modal title={t("usb.copy.title")} onCancel={() => setModal(null)}>
          <p className="evo-modal-body">
            {modal.notice === "oversized"
              ? t("usb.copy.oversized", { size: formatSize(modal.drive.sizeBytes) })
              : modal.notice === "hiberfile"
                ? t("usb.copy.hiberfileLong")
                : t("usb.copy.unsupportedLong", { fs: fsLabel(modal.drive.fsType) })}
          </p>
          <div className="evo-modal-actions">
            <button
              type="button"
              className="evo-modal-button evo-modal-button-primary"
              onClick={() => setModal(null)}
            >
              {t("dialog.close")}
            </button>
          </div>
        </Modal>
      ) : null}

      {pairOpen ? (
        <PairDeviceFlow onClose={() => setPairOpen(false)} onPaired={onPaired} />
      ) : null}
    </Fragment>
  );
}
