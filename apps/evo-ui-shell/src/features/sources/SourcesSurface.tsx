// SourcesSurface - the Sources menu destination (ruled S1-A).
// Phase 3c: mutations are LIVE when the session's bearer carries
// step_up:network_admin (see useNetworkShares for the mint recipe).
// Without it, every mutating control renders disabled with the
// reason - same honesty rule as before, now with a real unlock.
//
// Add-share dialog: name, SMB/NFS, host, path, credentials
// (Guest / User + password on the same dialog), advanced options.
// The secret rides network.share.add and is vaulted by the plugin.
// Key-file credentials wait for the vault key flow and say so.

import { useMemo, useState } from "preact/hooks";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  EyeOff,
  HardDrive,
  Library,
  Pencil,
  Plus,
  Radar,
  RotateCw,
  X
} from "lucide-preact";
import {
  reauthPromptResponder,
  usePromptListed
} from "../prompts/usePromptResponder";
import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import { canStartShareAdd } from "./share-add-gate";
import { sourcesHeartbeat } from "./share-state-live";
import {
  useDiscoveredNas,
  useNetworkShares,
  type AddSharePayload,
  type ShareItem
} from "./useNetworkShares";
import { friendlyShareError } from "./friendly-error";
import { isShareBusyReason } from "./share-busy";
import {
  SHARES_PLUGIN_ID,
  diffShareEdits,
  passwordKeyForEdit,
  shareCredentialKey
} from "./share-edit";
import { credentialPut } from "../credentials/credential-ops";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { KebabMenu } from "../../components/KebabMenu";
import { ConfirmDialog, Modal } from "../../components/dialogs";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { isPairRequired, isHouseholdLocked } from "../../runtime/authz-classify";
import { useHouseholdModal } from "../household/HouseholdModalHost";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

function stateKey(state: ShareItem["state"]): string {
  return `sources.state.${state}`;
}

type SourcesDialog =
  | null
  | {
      kind: "add";
      prefillHost?: string;
      prefillPath?: string;
      prefillFstype?: "cifs" | "nfs";
      /** Advertised shares of the discovered device - renders the
       *  picker (Volumio-style) instead of a blank path field. */
      availableShares?: string[];
    }
  | { kind: "edit"; share: ShareItem }
  | { kind: "remove"; share: ShareItem }
  /** The USB two-step: a busy Disconnect offers Force as a second,
   *  explicit press. Never opened by the first press. */
  | { kind: "force"; share: ShareItem };

export function SourcesSurface({
  onOpenInLibrary
}: {
  /** Deep-link a mounted share into Library (source id nas-<shareId>). */
  onOpenInLibrary?: (sourceId: string) => void;
} = {}) {
  useLocale();
  const shares = useNetworkShares();
  const discovery = useDiscoveredNas();
  // The shared page socket carries credential_put for a password typed
  // on Edit (the same path the file-sharing surface stocks an SMB user
  // on); it elevates through the operator-password card when
  // write:credentials asks for it.
  const fwTransport = tryUseFrameworkTransport();
  // A user+password Add types the secret on this dialog; it rides
  // network.share.add and the plugin vaults it, then mounts. Edit
  // stocks a typed password through credential_put first (see runEdit).
  // Household model: adding / managing a share is admitted on LAN-trust and
  // gated by the household policy, NOT by a client-side network_admin
  // pre-flight. We no longer pre-flight Pair (open the form; the dispatch
  // decides). A genuine pair-ceremony refusal still offers Pair below; a
  // household lock after the page is up (a spent override sitting, or a
  // policy that still locks the verb) paints the one household line and
  // opens the one household door - the entry gate stays the lock on entry;
  // the credential prompt for a credentialed SMB add remains a separate
  // responder concern.
  const [dialog, setDialog] = useState<SourcesDialog>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  // Set only on a pair-ceremony refusal. Controls stay enabled.
  // Household lock is a different flag; it never opens Pair.
  const [authRefused, setAuthRefused] = useState(false);
  // The one household door (null without a host, e.g. designer / tests:
  // then the line alone says what happened).
  const household = useHouseholdModal();
  const promptListed = usePromptListed();

  const configured = shares.items ?? [];
  const found = discovery.state?.nas ?? [];
  const configuredHosts = useMemo(
    () => new Set(configured.map((s) => s.host)),
    [configured]
  );

  const run = async (
    op: () => Promise<{ ok: boolean; message?: string; subclass?: string }>
  ) => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const r = await op();
    setBusy(false);
    if (!r.ok) {
      if (isPairRequired(r)) {
        setAuthRefused(true);
        setFeedback("");
      } else if (isHouseholdLocked(r)) {
        // Locked, not idle: the household line, and the door that can
        // resolve it. Never Pair.
        setAuthRefused(false);
        setFeedback(t("household.locked.body"));
        if (household !== null) household.open();
      } else {
        setFeedback(friendlyShareError(r.message));
      }
    } else {
      setAuthRefused(false);
    }
  };

  // Disconnect is the USB two-step. The first press is the clean
  // unmount: network.share.unmount with share_id only - the plugin
  // releases MPD, then umounts. When the plugin refuses because the
  // share is still in use, the page line says so in one sentence and
  // the Force confirm opens. Confirm is the second press: the same verb
  // with the force flag set, a real lazy detach on the plugin side. A
  // Force the plugin refuses paints the sentence and opens nothing more.
  // Holders, ids and the subprocess line never reach this surface.
  const runUnmount = async (share: ShareItem, force = false): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const r = await shares.unmount(share.shareId, force ? { force: true } : {});
    setBusy(false);
    if (r.ok) {
      setAuthRefused(false);
      return;
    }
    if (isPairRequired(r)) {
      setAuthRefused(true);
      setFeedback("");
      return;
    }
    if (isHouseholdLocked(r)) {
      setAuthRefused(false);
      setFeedback(t("household.locked.body"));
      if (household !== null) household.open();
      return;
    }
    setFeedback(friendlyShareError(r.message));
    if (!force && isShareBusyReason(r.message)) {
      setDialog({ kind: "force", share });
    }
  };

  // Edit. The field changes ride network.share.edit as a partial. A
  // password typed on the Edit dialog is stocked FIRST, in the device
  // vault under the key the record carries after the edit, through the
  // framework's credential_put - never inside the edit payload, which the
  // plugin would drop in silence. Then the edit. Then a share that is
  // not Connected is connected, so the new secret is the one in use. A
  // Connected share keeps its live session; the new secret takes effect
  // on its next connect - Disconnect and Connect are the operator's
  // gestures, never a surprise unmount.
  const runEdit = async (share: ShareItem, payload: AddSharePayload): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const edits = diffShareEdits(share, payload);
    const secret =
      payload.credentials.kind === "user_password" && payload.password !== undefined
        ? payload.password
        : "";
    if (secret.length > 0) {
      if (fwTransport === null) {
        setBusy(false);
        setFeedback(t("sources.notConnected"));
        return;
      }
      const key = passwordKeyForEdit(share, edits, payload.alias);
      const put = await credentialPut(fwTransport, {
        pluginId: SHARES_PLUGIN_ID,
        key,
        value: secret,
        displayName: `network.shares SMB credential - ${key}`,
        uninstallPolicy: "preserve_for_reinstall"
      });
      if (!put.ok) {
        setBusy(false);
        const sub = (put.subclass ?? "").toLowerCase();
        if (sub.includes("write_required") || sub.includes("write:cred")) {
          setFeedback(t("smb.err.needOperatorPassword"));
        } else if (sub.includes("vault")) {
          setFeedback(t("smb.err.vaultUnavailable"));
        } else {
          setFeedback(friendlyShareError(put.message));
        }
        return;
      }
    }
    if (Object.keys(edits).length > 0) {
      const r = await shares.edit(share.shareId, edits);
      if (!r.ok) {
        setBusy(false);
        if (isPairRequired(r)) {
          setAuthRefused(true);
          setFeedback("");
          return;
        }
        if (isHouseholdLocked(r)) {
          setAuthRefused(false);
          setFeedback(t("household.locked.body"));
          if (household !== null) household.open();
          return;
        }
        setFeedback(friendlyShareError(r.message));
        return;
      }
    }
    if (secret.length > 0 && share.state !== "mounted") {
      const m = await shares.mount(share.shareId);
      if (!m.ok) {
        setBusy(false);
        setFeedback(friendlyShareError(m.message));
        return;
      }
    }
    setBusy(false);
    setAuthRefused(false);
  };

  // Pair is offered ONLY on a genuine pair-ceremony refusal (authRefused),
  // never pre-flighted from session state. Pairing re-handshakes the bearer
  // in place; it is not the gate for LAN-trust settings under the household
  // model.
  const showAuthNotice = authRefused;
  const beat = sourcesHeartbeat(busy, shares.items);
  // The password card is the wait. A working scrim on top of it
  // is how the operator never sees the ask.

  return (
    <section className="card feature-surface sources-surface">
      {beat !== null && !promptListed ? (
        <HeartbeatPanel
          visible
          scrim
          mode="working"
          headline={
            beat.kind === "mounting"
              ? t("sources.heartbeat.connecting", { alias: beat.alias })
              : t("sources.heartbeat.working")
          }
          sublabel={
            beat.kind === "mounting"
              ? t("sources.heartbeat.connectingDetail")
              : t("sources.heartbeat.workingDetail")
          }
        />
      ) : null}
      <div className="feature-head">
        <div>
          <h3>{t("sources.title")}</h3>
          <p className="feature-description">{t("sources.description")}</p>
        </div>
        <button
          type="button"
          className="sources-add"
          disabled={busy}
          onClick={() => setDialog({ kind: "add" })}
        >
          <Plus size={16} />
          <span>{t("sources.addShare")}</span>
        </button>
      </div>
      {showAuthNotice ? (
        <div className="net-notice">
          <span>{t("sources.authNeeded")}</span>
          <button
            type="button"
            className="settings-link-button"
            onClick={() => setPairOpen(true)}
          >
            {t("sources.pairToManage")}
          </button>
        </div>
      ) : null}
      {feedback.length > 0 ? (
        <p className="sources-feedback" role="alert">{feedback}</p>
      ) : null}

      <p className="nav-group-title sources-section-title">{t("sources.mine")}</p>
      {shares.items === null ? (
        <p className="sources-empty">{t("collection.loading")}</p>
      ) : configured.length === 0 ? (
        <p className="sources-empty">{t("sources.noneYet")}</p>
      ) : (
        <div className="sources-grid">
          {configured.map((share) => (
            <div className="source-card" key={share.shareId}>
              <span className="source-card-art" aria-hidden>
                <HardDrive size={18} />
              </span>
              <div className="source-card-body">
                <p className="source-card-name">{share.alias}</p>
                <p className="source-card-sub">
                  {share.host}
                  {share.path.length > 0 ? ` / ${share.path}` : ""}
                </p>
                <div className="source-card-chips">
                  <span className={`source-badge source-badge-${share.state}`}>
                    {t(stateKey(share.state) as never)}
                  </span>
                  {share.negotiated !== null ? (
                    <span className="source-chip">{share.negotiated}</span>
                  ) : share.fstype !== "unknown" ? (
                    <span className="source-chip">{share.fstype.toUpperCase()}</span>
                  ) : null}
                </div>
                {share.state === "failed" && share.reason !== null ? (
                  <p className="source-card-error">
                    {friendlyShareError(share.reason)}
                  </p>
                ) : null}
              </div>
              <div className="source-card-actions">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={
                    share.state === "mounted"
                      ? t("sources.unmount")
                      : t("sources.mount")
                  }
                  onClick={() =>
                    share.state === "mounted"
                      ? void runUnmount(share)
                      : void run(() => shares.mount(share.shareId))
                  }
                >
                  {share.state === "mounted" ? (
                    <ArrowDownToLine size={14} />
                  ) : (
                    <ArrowUpFromLine size={14} />
                  )}
                </button>
                <KebabMenu
                  disabled={busy}
                  items={[
                    ...(share.state === "mounted" && onOpenInLibrary
                      ? [
                          {
                            id: "open",
                            icon: <Library size={14} />,
                            label: t("sources.openInLibrary"),
                            onSelect: () =>
                              onOpenInLibrary(`nas-${share.shareId}`)
                          }
                        ]
                      : []),
                    {
                      id: "edit",
                      icon: <Pencil size={14} />,
                      label: t("sources.edit"),
                      onSelect: () => setDialog({ kind: "edit", share })
                    },
                    {
                      id: "remove",
                      icon: <X size={14} />,
                      label: t("sources.remove"),
                      danger: true,
                      onSelect: () => setDialog({ kind: "remove", share })
                    }
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sources-section-head">
        <p className="nav-group-title sources-section-title">{t("sources.discover")}</p>
        <button
          type="button"
          className="sources-refresh"
          disabled={busy}
          onClick={() => void run(() => discovery.refresh())}
        >
          <RotateCw size={13} />
          <span>{t("sources.refresh")}</span>
        </button>
      </div>
      <p className="feature-description sources-hint">{t("sources.discoverHint")}</p>
      {discovery.state === null ? (
        <p className="sources-empty">{t("collection.loading")}</p>
      ) : found.length === 0 ? (
        <p className="sources-empty">
          <Radar size={14} className="sources-empty-ic" />
          {t("sources.nothingFound")}
        </p>
      ) : (
        <div className="sources-grid">
          {found.map((nas) => {
            const already = nas.alreadyConfigured || configuredHosts.has(nas.host);
            return (
              <div
                className={already ? "source-card source-card-dim" : "source-card"}
                key={`${nas.name}:${nas.host}`}
              >
                <span className="source-card-art" aria-hidden>
                  <Radar size={18} />
                </span>
                <div className="source-card-body">
                  <p className="source-card-name">{nas.name}</p>
                  <p className="source-card-sub">
                    {already ? t("sources.alreadyAdded") : nas.host}
                  </p>
                  {!already && (nas.fstype === "nfs" || nas.dialect !== null || nas.shares.length > 0) ? (
                    <div className="source-card-chips">
                      {nas.fstype === "nfs" ? (
                        <span className="source-chip">NFS</span>
                      ) : null}
                      {nas.dialect !== null ? (
                        <span className="source-chip">{nas.dialect}</span>
                      ) : null}
                      {nas.shares.slice(0, 4).map((s) => (
                        <span className="source-chip" key={s}>{s}</span>
                      ))}
                      {nas.shares.length > 4 ? (
                        <span className="source-chip">
                          {t("sources.moreShares", { n: nas.shares.length - 4 })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!already ? (
                  <div className="source-card-actions">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t("sources.add")}
                      onClick={() =>
                        setDialog({
                          kind: "add",
                          prefillHost: nas.host,
                          prefillFstype: nas.fstype,
                          prefillPath:
                            nas.fstype === "nfs" && nas.shares.length === 1
                              ? nas.shares[0]
                              : undefined,
                          availableShares: nas.shares
                        })
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {dialog?.kind === "add" ? (
        <AddShareDialog
          prefillHost={dialog.prefillHost}
          prefillPath={dialog.prefillPath}
          prefillFstype={dialog.prefillFstype}
          availableShares={dialog.availableShares}
          onCancel={() => setDialog(null)}
          onSubmit={(payload) => {
            setDialog(null);
            void run(() => shares.add(payload));
          }}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <AddShareDialog
          editShare={dialog.share}
          onCancel={() => setDialog(null)}
          onSubmit={(payload) => {
            const share = dialog.share;
            setDialog(null);
            void runEdit(share, payload);
          }}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          title={t("sources.removeTitle", { alias: dialog.share.alias })}
          message={t("sources.removeBody")}
          confirmLabel={t("sources.remove")}
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.share.shareId;
            setDialog(null);
            void run(() => shares.remove(id));
          }}
        />
      ) : null}
      {dialog?.kind === "force" ? (
        <ConfirmDialog
          title={t("sources.force.title", { alias: dialog.share.alias })}
          message={t("sources.force.message")}
          confirmLabel={t("sources.force.confirm")}
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const share = dialog.share;
            setDialog(null);
            void runUnmount(share, true);
          }}
        />
      ) : null}
      {pairOpen ? (
        // onPaired => pair IN PLACE (no reload): the operator chose Sources
        // and stays on Sources. We re-handshake BOTH bearer capabilities
        // with the new token - the shares/discovery sockets (network_admin
        // mutations) and the prompt responder (SMB password prompts) - so
        // every control lights up without leaving the page.
        <PairDeviceFlow
          onClose={() => setPairOpen(false)}
          onPaired={() => {
            setPairOpen(false);
            setAuthRefused(false);
            shares.reauth();
            discovery.reauth();
            reauthPromptResponder();
          }}
        />
      ) : null}
    </section>
  );
}

function AddShareDialog({
  editShare,
  prefillHost,
  prefillPath,
  prefillFstype,
  availableShares,
  onCancel,
  onSubmit
}: {
  /** When set, the form edits an existing share (pre-filled, full field
   *  parity incl. credentials + advanced options) instead of adding. */
  editShare?: ShareItem;
  prefillHost?: string;
  prefillPath?: string;
  prefillFstype?: "cifs" | "nfs";
  availableShares?: string[];
  onCancel: () => void;
  onSubmit: (payload: AddSharePayload) => void;
}) {
  useLocale();
  const [alias, setAlias] = useState(editShare?.alias ?? "");
  const [fstype, setFstype] = useState<"cifs" | "nfs">(
    editShare?.fstype === "nfs" || prefillFstype === "nfs" ? "nfs" : "cifs"
  );
  const [host, setHost] = useState(editShare?.host ?? prefillHost ?? "");
  const [path, setPath] = useState(editShare?.path ?? prefillPath ?? "");
  const pickable = availableShares !== undefined && availableShares.length > 0;
  const [credKind, setCredKind] = useState<"guest" | "user_password">(
    editShare?.credentialsKind === "user_password" ? "user_password" : "guest"
  );
  const [username, setUsername] = useState(editShare?.username ?? "");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [domain, setDomain] = useState(editShare?.domain ?? "");
  const [advanced, setAdvanced] = useState(editShare?.advancedOptions ?? "");
  const valid =
    alias.trim().length > 0 &&
    host.trim().length > 0 &&
    path.trim().length > 0 &&
    (credKind === "guest" ||
      (username.trim().length > 0 &&
        (editShare !== undefined || password.length > 0)));
  // Valid form starts. User+password Add requires the secret on
  // this dialog. Edit may reuse the vaulted secret.
  const canStart = canStartShareAdd({ valid, credKind });
  return (
    <Modal
      title={editShare ? t("sources.editShare", { alias: editShare.alias }) : t("sources.addShare")}
      onCancel={onCancel}
    >
      <form
        className="evo-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canStart) return;
          // Vault key derived from the alias (one definition, shared
          // with the Edit path). On Add the password rides the verb;
          // never on argv; the plugin vaults it and mounts. On Edit the
          // surface stocks it first and the edit carries no secret.
          onSubmit({
            alias: alias.trim(),
            fstype,
            host: host.trim(),
            path: path.trim(),
            credentials:
              credKind === "guest"
                ? { kind: "guest" }
                : {
                    kind: "user_password",
                    username: username.trim(),
                    credential_key: shareCredentialKey(alias),
                    ...(domain.trim().length > 0
                      ? { domain: domain.trim() }
                      : {})
                  },
            ...(credKind === "user_password" && password.length > 0
              ? { password }
              : {}),
            ...(advanced.trim().length > 0
              ? { advanced_options: advanced.trim() }
              : {})
          });
        }}
      >
        <label className="evo-modal-label">
          {t("sources.form.name")}
          <input
            className="evo-modal-input"
            type="text"
            value={alias}
            onInput={(e) => setAlias((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div className="sources-form-row">
          <span className="evo-modal-label">{t("sources.form.type")}</span>
          <div className="stb-seg" role="radiogroup">
            {(["cifs", "nfs"] as const).map((ft) => (
              <button
                key={ft}
                type="button"
                className={fstype === ft ? "on" : undefined}
                role="radio"
                aria-checked={fstype === ft}
                onClick={() => setFstype(ft)}
              >
                {ft === "cifs" ? "SMB" : "NFS"}
              </button>
            ))}
          </div>
        </div>
        <label className="evo-modal-label">
          {t("sources.form.host")}
          <input
            className="evo-modal-input"
            type="text"
            value={host}
            onInput={(e) => setHost((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        {pickable ? (
          <>
            <span className="evo-modal-label">{t("sources.form.pickShare")}</span>
            <ul className="evo-picker-list sources-share-picker">
              {availableShares.map((share) => {
                const selected = path === share;
                return (
                  <li key={share}>
                    <button
                      type="button"
                      className={
                        selected
                          ? "evo-picker-item evo-picker-item-selected"
                          : "evo-picker-item"
                      }
                      aria-pressed={selected}
                      onClick={() => {
                        setPath(share);
                        if (alias.trim().length === 0) setAlias(share);
                      }}
                    >
                      <span className="evo-picker-name">{share}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <label className="evo-modal-label">
          {pickable ? t("sources.form.pathManual") : t("sources.form.path")}
          <input
            className="evo-modal-input"
            type="text"
            value={path}
            placeholder={fstype === "cifs" ? "Music" : "/export/music"}
            onInput={(e) => setPath((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div className="sources-form-row">
          <span className="evo-modal-label">{t("sources.form.credentials")}</span>
          <div className="stb-seg" role="radiogroup">
            <button
              type="button"
              className={credKind === "guest" ? "on" : undefined}
              role="radio"
              aria-checked={credKind === "guest"}
              onClick={() => setCredKind("guest")}
            >
              {t("sources.form.guest")}
            </button>
            <button
              type="button"
              className={credKind === "user_password" ? "on" : undefined}
              role="radio"
              aria-checked={credKind === "user_password"}
              onClick={() => setCredKind("user_password")}
            >
              {t("sources.form.userPassword")}
            </button>
            <button type="button" disabled title={t("sources.form.keyFilePending")}>
              {t("sources.form.keyFile")}
            </button>
          </div>
        </div>
        {credKind === "user_password" ? (
          <>
            <label className="evo-modal-label">
              {t("sources.form.username")}
              <input
                className="evo-modal-input"
                type="text"
                autocomplete="off"
                value={username}
                onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label className="evo-modal-label">
              {t("sources.form.password")}
              <span className="password-field">
                <input
                  className="evo-modal-input"
                  type={reveal ? "text" : "password"}
                  autocomplete="new-password"
                  placeholder={editShare ? t("sources.form.passwordKeep") : undefined}
                  value={password}
                  onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  className="password-reveal-button"
                  aria-label={reveal ? t("password.hide") : t("password.show")}
                  aria-pressed={reveal}
                  onClick={() => setReveal((r) => !r)}
                >
                  {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <label className="evo-modal-label">
              {t("sources.form.domain")}
              <input
                className="evo-modal-input"
                type="text"
                autocomplete="off"
                placeholder={t("sources.form.domainHint")}
                value={domain}
                onInput={(e) => setDomain((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          </>
        ) : null}
        <label className="evo-modal-label">
          {t("sources.form.advanced")}
          <input
            className="evo-modal-input"
            type="text"
            // One field for CIFS and NFS: the hint must not be a CIFS
            // dialect recipe an NFS operator would copy into a mount that
            // cannot work. Extra mount options only; no vers= default.
            placeholder={t("sources.form.advancedHint")}
            value={advanced}
            onInput={(e) => setAdvanced((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div className="evo-modal-actions">
          <button
            type="button"
            className="evo-modal-button evo-modal-button-secondary"
            onClick={onCancel}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="submit"
            className="evo-modal-button evo-modal-button-primary"
            disabled={!canStart}
          >
            {editShare ? t("sources.form.save") : t("sources.form.addAndMount")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
