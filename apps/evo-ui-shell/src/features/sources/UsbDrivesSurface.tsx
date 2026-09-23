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

import { useEffect, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";
import type { JSX } from "preact";
import { ConfirmDialog, Modal } from "../../components/dialogs";
import {
  UsbRemovalHeartbeat,
  UsbSafeToRemoveModal
} from "./UsbRemovalHeartbeat";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { isPairRequired, isHouseholdLocked } from "../../runtime/authz-classify";
import { useHouseholdModal } from "../household/HouseholdModalHost";
import { reauthPromptResponder } from "../prompts/usePromptResponder";
import { friendlyVerbError } from "./friendly-error";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useLibrary } from "../library/useLibrary";
import { useUsbDrives, type UsbVerbResult } from "./useUsbDrives";
import {
  usbRefuseData,
  usbRemovalMatches,
  type UsbDrive,
  type UsbDriveClass,
  type UsbIdSource,
  type UsbRemoval,
  type UsbRemovalStage
} from "./usb-drives-decoders";

// Server-side enforced token (USB-STORAGE.md section 3); applied live so
// submit disables on invalid input.
const RENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** After storage.usb.safe_remove answered ok, how long the glass waits
 *  for the subject's "safe" frame before it paints "The volume is still
 *  attached." The plugin announces "safe" before it replies, so this
 *  only ever fires on a missed frame. It never advances a stage and
 *  never opens the modal. */
const USB_REMOVE_SAFE_GRACE_MS = 4000;

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
  const library = useLibrary();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRefused, setAuthRefused] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [modal, setModal] = useState<UsbModal | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [usbRemove, setUsbRemove] = useState<{
    stableId: string;
    librarySourceId: string | null;
    /** The last stage the subject named for THIS remove; null until it
     *  names one. */
    stage: UsbRemovalStage | null;
    verbDone: boolean;
  } | null>(null);
  const [usbSafeModal, setUsbSafeModal] = useState(false);
  // The removal frame already on the subject at the press - stale by
  // definition - so only a frame that arrived after it counts.
  const staleRemovalRef = useRef<UsbRemoval | null>(null);
  // The one household door (null without a host, e.g. designer / tests:
  // then the line alone says what happened).
  const household = useHouseholdModal();

  const onPaired = (): void => {
    setAuthRefused(false);
    setPairOpen(false);
    usb.reauth();
    reauthPromptResponder();
  };

  // One classifier for every refused verb, whichever path sent it: the
  // pair / household doors, the Force fallback on a busy stick, repair
  // escalation, the copy notices, the friendly message. Force stays the
  // busy fallback - never the truth path.
  const refuse = (
    r: Extract<UsbVerbResult, { ok: false }>,
    drive: UsbDrive,
    ctx: "mount" | "saferemove" | "repair" | "rename"
  ): void => {
    if (isPairRequired(r)) {
      setAuthRefused(true);
      return;
    }
    if (isHouseholdLocked(r)) {
      // Locked, not idle: the household line, and the door that can
      // resolve it. Never Pair, never the busy / repair / copy classifiers.
      setAuthRefused(false);
      setFeedback(t("household.locked.body"));
      if (household !== null) household.open();
      return;
    }
    const probe = `${r.subclass ?? ""} ${r.message}`.toLowerCase();
    // Safe Remove that failed is Force, not "That didn't work."
    // library.remove_source during an MPD index wraps the USB
    // refuse so "busy" / holders never reach this probe.
    if (ctx === "saferemove") {
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
    if (r.ok) {
      return;
    }
    refuse(r, drive, ctx);
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

  // Safe remove: with a library id, one library.remove_source - the
  // path that drops the queue then detaches. Direct safe_remove only
  // when there is no library id, or Force (the first attempt has
  // already released the queue). Stages still follow
  // storage_usb_drives.removal only. The modal opens when the
  // subject names "safe", or the row is gone after we started —
  // not after the verb returns. Force's catalogue drop can still
  // be waiting on MPD. A leftover safe frame is not ignored; a
  // later retract must not rewind past safe. No stage is claimed
  // before a frame names it; no timer advances a stage. A verb
  // that answered ok with no "safe" and the row still present
  // inside a bounded wait is a failure paint, never the modal.
  const runSafeRemove = async (drive: UsbDrive, force = false): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    staleRemovalRef.current = usb.removal;
    setUsbRemove({
      stableId: drive.stableId,
      librarySourceId: drive.librarySourceId,
      stage: null,
      verbDone: false
    });
    const r: UsbVerbResult =
      !force && drive.librarySourceId !== null
        ? await library.removeSource(drive.librarySourceId).then((lr) =>
            lr.ok
              ? { ok: true }
              : {
                  ok: false,
                  message: lr.message,
                  subclass: null,
                  data: usbRefuseData(null)
                }
          )
        : await usb.safeRemove(
            drive.stableId,
            force,
            drive.librarySourceId
          );
    if (!r.ok) {
      setUsbRemove(null);
      setBusy(false);
      refuse(r, drive, "saferemove");
      return;
    }
    setUsbRemove((prev) =>
      prev !== null && prev.stableId === drive.stableId
        ? { ...prev, verbDone: true }
        : prev
    );
  };

  const renameValid =
    renameDraft.trim().length === 0 || RENAME_RE.test(renameDraft.trim());

  const drives = usb.drives;
  // Stages: from the subject, and only from the subject.
  useEffect(() => {
    if (usbRemove === null) return;
    const incoming = usb.removal;
    if (incoming === null) return;
    if (incoming === staleRemovalRef.current && incoming.stage !== "safe") return;
    if (
      usbRemovalMatches(incoming, {
        stableId: usbRemove.stableId,
        sourceId: usbRemove.librarySourceId ?? undefined
      }) &&
      incoming.stage !== usbRemove.stage
    ) {
      // Force after a first detach re-announces retract. Do not
      // rewind past safe — that stuck the heartbeat on
      // "Updating the library" after the stick was already gone.
      const order: UsbRemovalStage[] = ["queue", "detach", "eject", "retract", "safe"];
      const prev = usbRemove.stage;
      if (
        prev !== null &&
        order.indexOf(incoming.stage) < order.indexOf(prev)
      ) {
        return;
      }
      setUsbRemove({ ...usbRemove, stage: incoming.stage });
    }
  }, [usb.removal, usbRemove]);

  // The modal gate: the subject named "safe" (the volume is off
  // the host). Do not wait for the verb to finish — Force's
  // catalogue drop waits on an in-flight MPD index and would
  // leave "Updating the library" up after the stick is gone.
  // A vanished row after we started is the same signal.
  useEffect(() => {
    if (usbRemove === null) return;
    const gone =
      drives !== null &&
      !drives.some((d) => d.stableId === usbRemove.stableId);
    if (usbRemove.stage === "safe" || (gone && usbRemove.stage !== null)) {
      setUsbRemove(null);
      setUsbSafeModal(true);
      setBusy(false);
      return;
    }
    if (!usbRemove.verbDone) return;
    // Bounded wait for the frames that should already be in flight.
    // Past it: a failure paint, not the modal. Never sets a stage.
    const handle = window.setTimeout(() => {
      setUsbRemove(null);
      setBusy(false);
      setFeedback(t("usb.removeFailed"));
    }, USB_REMOVE_SAFE_GRACE_MS);
    return () => window.clearTimeout(handle);
  }, [usbRemove, drives]);

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
                  onClick={() => void runSafeRemove(drive)}
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
            void runSafeRemove(d, true);
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

      {usbRemove !== null ? (
        <UsbRemovalHeartbeat visible stage={usbRemove.stage} />
      ) : null}
      {usbSafeModal ? (
        <UsbSafeToRemoveModal onAck={() => setUsbSafeModal(false)} />
      ) : null}
    </Fragment>
  );
}
