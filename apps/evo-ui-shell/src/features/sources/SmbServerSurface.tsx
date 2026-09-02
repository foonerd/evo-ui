// SmbServerSurface - the device's own SMB file server. Enable the
// server, pick the minimum protocol, and manage SMB users. The device
// shares its library OUT; distinct from Sources (which mounts NAS in).
// Mutations are network_admin step-up gated, so the same on-surface
// "Pair this device" path as Sources drives elevation in place. User
// passwords never ride the wire - user_add carries a credential_key and
// the device prompts for the password (responder renders it).

import { useEffect, useState } from "preact/hooks";
import { KeyRound, Plus, ShieldAlert, Trash2, UserRound } from "lucide-preact";
import { Modal, ConfirmDialog } from "../../components/dialogs";
import { PasswordField } from "../../components/PasswordField";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { reauthPromptResponder } from "../prompts/usePromptResponder";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { credentialPut } from "../credentials/credential-ops";
import { hasNetworkAdmin } from "./useNetworkShares";
import { useSmbServer, extraShareToWire } from "./useSmbServer";
import { friendlyVerbError } from "./friendly-error";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

const SMB_PLUGIN_ID = "org.evoframework.network.smb-server";

const PROTOCOLS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "default", label: "Auto" },
  { id: "smb2_02", label: "SMB 2" },
  { id: "smb3_02", label: "SMB 3" }
];

/** RFC 1123 host label: 1-63 chars, alnum start/end, hyphens inside. */
function isValidHostname(name: string): boolean {
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name);
}

function isAuthRefusal(r: { message?: string; subclass?: string }): boolean {
  if (r.subclass === "step_up_required" || r.subclass === "pair_expired") return true;
  return /step.?up|scope|permission|denied|unauthori|not.?hold|network_admin|pair/i.test(
    r.message ?? ""
  );
}

export function SmbServerSurface() {
  useLocale();
  const smb = useSmbServer();
  const fwTransport = tryUseFrameworkTransport();
  const admin = hasNetworkAdmin();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const [authRefused, setAuthRefused] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [resetting, setResetting] = useState<
    { username: string; mappedDomain: string | null } | null
  >(null);
  // Local hostname edit; null = untouched, fall back to the device value.
  const [hostnameEdit, setHostnameEdit] = useState<string | null>(null);
  // Honest failure semantics: if the read never lands (e.g. the SMB
  // server plugin failed admission on this boot), don't spin forever -
  // after a short grace show an explicit "unavailable" with a retry.
  const [timedOut, setTimedOut] = useState(false);

  const state = smb.state;

  useEffect(() => {
    if (state !== null) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(id);
  }, [state]);

  const retry = () => {
    setTimedOut(false);
    smb.reauth();
  };
  const showAuthNotice = !admin || authRefused;

  const run = async (
    op: () => Promise<{ ok: boolean; message?: string; subclass?: string }>
  ) => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const r = await op();
    setBusy(false);
    if (!r.ok) {
      if (isAuthRefusal(r)) {
        // Elevation is handled by the pair notice - never surface a raw
        // scope/permission chain as a scary error line.
        setAuthRefused(true);
        setFeedback("");
      } else {
        setFeedback(friendlyVerbError(r.message));
      }
    } else {
      setAuthRefused(false);
    }
  };

  // apply is a full replacement - carry the fields we are not editing
  // (extra_shares) through unchanged so a toggle never drops them.
  const applyWith = (patch: { enabled?: boolean; min_protocol?: string }) =>
    run(() =>
      smb.apply({
        enabled: patch.enabled ?? state?.enabled ?? false,
        min_protocol: patch.min_protocol ?? state?.minProtocol ?? "default",
        extra_shares: (state?.extraShares ?? []).map(extraShareToWire)
      })
    );

  // Add an SMB user: stock the password in the device vault first (the
  // smb-server plugin fetches it and never prompts), then user_add. The
  // credential_put rides the shared framework socket and elevates via
  // the operator-password card if write:credentials is required.
  const addSmbUser = async (
    username: string,
    password: string,
    mappedDomain?: string
  ) => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    if (fwTransport === null) {
      setBusy(false);
      setFeedback(t("sources.notConnected"));
      return;
    }
    const key = `vault:smb:${username}`;
    const put = await credentialPut(fwTransport, {
      pluginId: SMB_PLUGIN_ID,
      key,
      value: password,
      displayName: username
    });
    if (!put.ok) {
      setBusy(false);
      // Route on the structured subclass so the operator sees the real
      // cause, not a generic failure. credential_put refuses with
      // credentials_write_required (needs operator-password elevation)
      // or vault_unavailable; anything else falls back to the mapper.
      const sub = (put.subclass ?? "").toLowerCase();
      if (sub.includes("write_required") || sub.includes("write:cred")) {
        setFeedback(t("smb.err.needOperatorPassword"));
      } else if (sub.includes("vault")) {
        setFeedback(t("smb.err.vaultUnavailable"));
      } else {
        setFeedback(friendlyVerbError(put.message));
      }
      return;
    }
    const r = await smb.addUser(username, key, mappedDomain);
    setBusy(false);
    if (!r.ok) {
      if (isAuthRefusal(r)) setAuthRefused(true);
      else setFeedback(friendlyVerbError(r.message));
    } else {
      setAuthRefused(false);
    }
  };

  // Set the device network name via smb_server.apply(system_hostname);
  // carries the current server config through unchanged.
  const saveHostname = async () => {
    if (busy) return;
    const name = (hostnameEdit ?? state?.hostname ?? "").trim();
    if (!isValidHostname(name)) {
      setFeedback(t("smb.hostnameInvalid"));
      return;
    }
    setBusy(true);
    setFeedback("");
    const r = await smb.apply({
      enabled: state?.enabled ?? false,
      min_protocol: state?.minProtocol ?? "default",
      extra_shares: (state?.extraShares ?? []).map(extraShareToWire),
      system_hostname: name
    });
    setBusy(false);
    if (!r.ok) {
      if (isAuthRefusal(r)) setAuthRefused(true);
      else setFeedback(friendlyVerbError(r.message));
    } else {
      setAuthRefused(false);
      setHostnameEdit(null);
      setFeedback(t("smb.hostnameSaved"));
    }
  };

  const onPaired = () => {
    setPairOpen(false);
    setAuthRefused(false);
    smb.reauth();
    reauthPromptResponder();
  };

  return (
    <section className="card feature-surface">
      <p className="feature-description">{t("smb.description")}</p>

      {showAuthNotice && !(state === null && timedOut) ? (
        <div className="net-notice">
          <span>{t("smb.authNeeded")}</span>
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

      {state === null ? (
        timedOut ? (
          <div className="sources-empty">
            <p>{t("smb.unavailable")}</p>
            <button
              type="button"
              className="settings-link-button"
              onClick={retry}
            >
              {t("smb.tryAgain")}
            </button>
          </div>
        ) : (
          <p className="sources-empty">{t("collection.loading")}</p>
        )
      ) : (
        <>
          <div className="sources-form-row">
            <span className="evo-modal-label">{t("smb.deviceName")}</span>
            <input
              className="evo-modal-input smb-hostname-input"
              type="text"
              value={hostnameEdit ?? state.hostname ?? ""}
              placeholder="living-room"
              disabled={busy}
              onInput={(e) =>
                setHostnameEdit((e.currentTarget as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              className="sources-refresh"
              disabled={
                busy || (hostnameEdit ?? state.hostname ?? "").trim().length === 0
              }
              onClick={() => void saveHostname()}
            >
              {t("smb.saveName")}
            </button>
          </div>
          <p className="feature-description sources-hint">
            {t("smb.deviceNameHint")}
          </p>

          <div className="sources-form-row">
            <span className="evo-modal-label">{t("smb.enabled")}</span>
            <div className="stb-seg" role="radiogroup">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  className={state.enabled === on ? "on" : undefined}
                  role="radio"
                  aria-checked={state.enabled === on}
                  disabled={busy}
                  onClick={() => void applyWith({ enabled: on })}
                >
                  {on ? t("smb.on") : t("smb.off")}
                </button>
              ))}
            </div>
          </div>

          <div className="sources-form-row">
            <span className="evo-modal-label">{t("smb.minProtocol")}</span>
            <div className="stb-seg" role="radiogroup">
              {PROTOCOLS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={state.minProtocol === p.id ? "on" : undefined}
                  role="radio"
                  aria-checked={state.minProtocol === p.id}
                  disabled={busy}
                  onClick={() => void applyWith({ min_protocol: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sources-section-head">
            <p className="nav-group-title sources-section-title">{t("smb.users")}</p>
            <button
              type="button"
              className="sources-refresh"
              disabled={busy}
              onClick={() => setAddOpen(true)}
            >
              <Plus size={13} />
              <span>{t("smb.addUser")}</span>
            </button>
          </div>
          {state.users.length === 0 ? (
            <p className="sources-empty">{t("smb.noUsers")}</p>
          ) : (
            <ul className="sources-activity">
              {state.users.map((u) => (
                <li key={u.username} className="sources-activity-item">
                  <span className="sources-activity-icon" aria-hidden>
                    <UserRound size={14} />
                  </span>
                  <div className="sources-activity-body">
                    <span className="sources-activity-line">{u.username}</span>
                    {u.mappedDomainIdentity !== null ? (
                      <span className="source-card-sub">{u.mappedDomainIdentity}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy}
                    aria-label={t("smb.changePassword")}
                    title={t("smb.changePassword")}
                    onClick={() =>
                      setResetting({
                        username: u.username,
                        mappedDomain: u.mappedDomainIdentity
                      })
                    }
                  >
                    <KeyRound size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy}
                    aria-label={t("smb.revoke")}
                    title={t("smb.revoke")}
                    onClick={() => setRevoking(u.username)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="feature-description sources-hint">
            <ShieldAlert size={13} className="sources-empty-ic" />
            {t("smb.passwordHint")}
          </p>
        </>
      )}

      {addOpen ? (
        <AddUserDialog
          onCancel={() => setAddOpen(false)}
          onSubmit={(username, password, mappedDomain) => {
            setAddOpen(false);
            void addSmbUser(username, password, mappedDomain);
          }}
        />
      ) : null}
      {resetting !== null ? (
        <ChangePasswordDialog
          username={resetting.username}
          onCancel={() => setResetting(null)}
          onSubmit={(password) => {
            const r = resetting;
            setResetting(null);
            // Re-applying an existing user with a new password: the device
            // stores it in the vault and user_add adopts/resets - same
            // store-then-apply flow as add, no new verb.
            void addSmbUser(r.username, password, r.mappedDomain ?? undefined);
          }}
        />
      ) : null}
      {revoking !== null ? (
        <ConfirmDialog
          title={t("smb.revokeTitle", { name: revoking })}
          message={t("smb.revokeBody")}
          confirmLabel={t("smb.revoke")}
          destructive
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const name = revoking;
            setRevoking(null);
            void run(() => smb.revokeUser(name));
          }}
        />
      ) : null}
      {pairOpen ? (
        <PairDeviceFlow onClose={() => setPairOpen(false)} onPaired={onPaired} />
      ) : null}
    </section>
  );
}

function AddUserDialog({
  onCancel,
  onSubmit
}: {
  onCancel: () => void;
  onSubmit: (username: string, password: string, mappedDomain?: string) => void;
}) {
  useLocale();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const valid =
    /^[A-Za-z0-9._-]+$/.test(username.trim()) &&
    username.trim().length > 0 &&
    password.length > 0;
  return (
    <Modal title={t("smb.addUser")} onCancel={onCancel}>
      <form
        className="evo-modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit(
            username.trim(),
            password,
            domain.trim().length > 0 ? domain.trim() : undefined
          );
        }}
      >
        <label className="evo-modal-label">
          {t("smb.form.username")}
          <input
            className="evo-modal-input"
            type="text"
            autocomplete="off"
            value={username}
            onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label className="evo-modal-label">
          {t("smb.form.password")}
          <PasswordField
            className="evo-modal-input"
            value={password}
            onInput={setPassword}
            ariaLabel={t("smb.form.password")}
          />
        </label>
        <label className="evo-modal-label">
          {t("smb.form.mappedDomain")}
          <input
            className="evo-modal-input"
            type="text"
            autocomplete="off"
            placeholder={t("smb.form.mappedDomainHint")}
            value={domain}
            onInput={(e) => setDomain((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <p className="evo-modal-hint">{t("smb.form.passwordStored")}</p>
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
            disabled={!valid}
          >
            {t("smb.addUser")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ChangePasswordDialog({
  username,
  onCancel,
  onSubmit
}: {
  username: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  useLocale();
  const [password, setPassword] = useState("");
  const valid = password.length > 0;
  return (
    <Modal title={t("smb.changePasswordTitle", { name: username })} onCancel={onCancel}>
      <form
        className="evo-modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit(password);
        }}
      >
        <label className="evo-modal-label">
          {t("smb.form.newPassword")}
          <PasswordField
            className="evo-modal-input"
            value={password}
            onInput={setPassword}
            ariaLabel={t("smb.form.newPassword")}
          />
        </label>
        <p className="evo-modal-hint">{t("smb.form.passwordStored")}</p>
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
            disabled={!valid}
          >
            {t("smb.changePassword")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
