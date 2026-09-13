// SourcesSurface - the Sources menu destination (ruled S1-A).
// Phase 3c: mutations are LIVE when the session's bearer carries
// step_up:network_admin (see useNetworkShares for the mint recipe).
// Without it, every mutating control renders disabled with the
// reason - same honesty rule as before, now with a real unlock.
//
// Add-share dialog per the sources sheet: name, SMB/NFS, host,
// path, credentials (Guest / User + password - the password itself
// NEVER has a field here; the plugin asks through the framework
// prompt card), advanced options. Key-file credentials wait for
// the vault key flow and say so.

import { useMemo, useState } from "preact/hooks";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  HardDrive,
  Library,
  Pencil,
  Plus,
  Radar,
  RotateCw,
  X
} from "lucide-preact";
import type { JSX } from "preact";
import { reauthPromptResponder, useResponderGranted } from "../prompts/usePromptResponder";
import {
  canStartShareAdd,
  showCredentialResponderNotice
} from "./share-add-gate";
import {
  useDiscoveredNas,
  useNetworkShares,
  type AddSharePayload,
  type EditSharePayload,
  type ShareItem
} from "./useNetworkShares";
import type { ShareEventKind } from "./share-decoders";
import { friendlyVerbError } from "./friendly-error";
import { KebabMenu } from "../../components/KebabMenu";
import { ConfirmDialog, Modal } from "../../components/dialogs";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { isPairRequired, isHouseholdLocked } from "../../runtime/authz-classify";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

function stateKey(state: ShareItem["state"]): string {
  return `sources.state.${state}`;
}

/** Reduce a full form payload to the fields that actually changed vs the
 *  existing share, so network.share.edit only touches what the operator
 *  altered (credentials are only re-sent when kind/username/domain change,
 *  so an unrelated edit never re-prompts for the password). */
function diffShareEdits(share: ShareItem, next: AddSharePayload): EditSharePayload {
  const edits: EditSharePayload = {};
  if (next.alias !== share.alias) edits.alias = next.alias;
  if (next.fstype !== share.fstype) edits.fstype = next.fstype;
  if (next.host !== share.host) edits.host = next.host;
  if (next.path !== share.path) edits.path = next.path;
  const nextAdvanced = next.advanced_options ?? "";
  if (nextAdvanced !== share.advancedOptions) edits.advanced_options = nextAdvanced;
  const c = next.credentials;
  const credChanged =
    c.kind !== share.credentialsKind ||
    (c.kind === "user_password" &&
      (c.username !== (share.username ?? "") ||
        (c.domain ?? "") !== (share.domain ?? "")));
  if (credChanged) edits.credentials = c;
  return edits;
}

function eventIcon(kind: ShareEventKind): JSX.Element {
  if (kind === "mounted") return <Check size={14} />;
  if (kind === "unmounted") return <ArrowDownToLine size={14} />;
  return <AlertTriangle size={14} />;
}

function eventLabelKey(kind: ShareEventKind): string {
  return `sources.event.${kind}`;
}

/** Locale-aware coarse relative time (snapshot; re-renders on new events). */
function relTime(atMs: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffS = Math.round((atMs - Date.now()) / 1000);
  const abs = Math.abs(diffS);
  if (abs < 60) return rtf.format(diffS, "second");
  if (abs < 3600) return rtf.format(Math.round(diffS / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffS / 3600), "hour");
  return rtf.format(Math.round(diffS / 86400), "day");
}

type SourcesDialog =
  | null
  | {
      kind: "add";
      prefillHost?: string;
      prefillPath?: string;
      /** Advertised shares of the discovered device - renders the
       *  picker (Volumio-style) instead of a blank path field. */
      availableShares?: string[];
    }
  | { kind: "edit"; share: ShareItem }
  | { kind: "remove"; share: ShareItem };

export function SourcesSurface({
  onOpenInLibrary
}: {
  /** Deep-link a mounted share into Library (source id nas-<shareId>). */
  onOpenInLibrary?: (sourceId: string) => void;
} = {}) {
  useLocale();
  const shares = useNetworkShares();
  const discovery = useDiscoveredNas();
  // Whether THIS session can paint the credential PromptSurface. A user+password
  // add stocks its secret through that prompt; without the responder the add
  // must fail closed (see share-add-gate). NOT a network_admin pre-flight.
  const responderGranted = useResponderGranted();
  // Household model: adding / managing a share is admitted on LAN-trust and
  // gated by the household policy, NOT by a client-side network_admin
  // pre-flight. We no longer pre-flight Pair (open the form; the dispatch
  // decides). A genuine pair-ceremony refusal still offers Pair below; a
  // household lock shows the household banner; the credential prompt for a
  // credentialed SMB add remains a separate responder concern.
  const [dialog, setDialog] = useState<SourcesDialog>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  // Set only on a pair-ceremony refusal. Controls stay enabled.
  // Household lock is a different flag; it never opens Pair.
  const [authRefused, setAuthRefused] = useState(false);

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
        setAuthRefused(false);
        setFeedback("");
      } else {
        setFeedback(friendlyVerbError(r.message));
      }
    } else {
      setAuthRefused(false);
    }
  };

  // Pair is offered ONLY on a genuine pair-ceremony refusal (authRefused),
  // never pre-flighted from session state. Pairing re-handshakes the bearer
  // in place; it is not the gate for LAN-trust settings under the household
  // model.
  const showAuthNotice = authRefused;

  return (
    <section className="card feature-surface sources-surface">
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
                  <p className="source-card-error">{share.reason}</p>
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
                    void run(() =>
                      share.state === "mounted"
                        ? shares.unmount(share.shareId)
                        : shares.mount(share.shareId)
                    )
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

      {shares.events.length > 0 ? (
        <>
          <p className="nav-group-title sources-section-title">{t("sources.activity")}</p>
          <ul className="sources-activity">
            {shares.events
              .slice()
              .reverse()
              .slice(0, 12)
              .map((ev, i) => {
                const share = configured.find((s) => s.shareId === ev.shareId);
                const failed =
                  ev.kind === "mount_failed" || ev.kind === "unmount_failed";
                return (
                  <li
                    key={`${ev.atMs}-${ev.shareId}-${i}`}
                    className={
                      failed
                        ? "sources-activity-item sources-activity-failed"
                        : "sources-activity-item"
                    }
                  >
                    <span className="sources-activity-icon" aria-hidden>
                      {eventIcon(ev.kind)}
                    </span>
                    <div className="sources-activity-body">
                      <span className="sources-activity-line">
                        <strong>{share?.alias ?? ev.shareId}</strong>{" "}
                        {t(eventLabelKey(ev.kind) as never)}
                        {ev.negotiatedVersion !== null
                          ? ` (${ev.negotiatedVersion})`
                          : ""}
                      </span>
                      {failed && ev.detail !== null ? (
                        <span className="sources-activity-detail">{ev.detail}</span>
                      ) : null}
                    </div>
                    <span className="sources-activity-time">{relTime(ev.atMs)}</span>
                  </li>
                );
              })}
          </ul>
        </>
      ) : null}

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
                  {!already && (nas.dialect !== null || nas.shares.length > 0) ? (
                    <div className="source-card-chips">
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
          availableShares={dialog.availableShares}
          responderGranted={responderGranted}
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
          responderGranted={responderGranted}
          onCancel={() => setDialog(null)}
          onSubmit={(payload) => {
            const share = dialog.share;
            setDialog(null);
            void run(() => shares.edit(share.shareId, diffShareEdits(share, payload)));
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
  availableShares,
  responderGranted,
  onCancel,
  onSubmit
}: {
  /** When set, the form edits an existing share (pre-filled, full field
   *  parity incl. credentials + advanced options) instead of adding. */
  editShare?: ShareItem;
  prefillHost?: string;
  prefillPath?: string;
  availableShares?: string[];
  /** Whether this session can paint the credential prompt. A user+password
   *  submit is blocked (fail closed) when it cannot. */
  responderGranted: boolean;
  onCancel: () => void;
  onSubmit: (payload: AddSharePayload) => void;
}) {
  useLocale();
  const [alias, setAlias] = useState(editShare?.alias ?? "");
  const [fstype, setFstype] = useState<"cifs" | "nfs">(
    editShare?.fstype === "nfs" ? "nfs" : "cifs"
  );
  const [host, setHost] = useState(editShare?.host ?? prefillHost ?? "");
  const [path, setPath] = useState(editShare?.path ?? prefillPath ?? "");
  const pickable = availableShares !== undefined && availableShares.length > 0;
  const [credKind, setCredKind] = useState<"guest" | "user_password">(
    editShare?.credentialsKind === "user_password" ? "user_password" : "guest"
  );
  const [username, setUsername] = useState(editShare?.username ?? "");
  const [domain, setDomain] = useState(editShare?.domain ?? "");
  const [advanced, setAdvanced] = useState(editShare?.advancedOptions ?? "");
  const valid =
    alias.trim().length > 0 &&
    host.trim().length > 0 &&
    path.trim().length > 0 &&
    (credKind === "guest" || username.trim().length > 0);
  // Valid form starts. User+password prompt paints on the responder
  // (usually the player), not only on this session. Not a Pair path.
  const canStart = canStartShareAdd({ valid, credKind, responderGranted });
  const showResponderNotice = showCredentialResponderNotice({
    credKind,
    responderGranted
  });
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
          // Vault key derived from the alias. network.share.add
          // persists, then mount_share → ensure_credential_stocked.
          // The password is prompted on the responder, stored in
          // the vault file, never on this form and never on argv.
          const slug = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
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
                    credential_key: `share.${slug}`,
                    ...(domain.trim().length > 0
                      ? { domain: domain.trim() }
                      : {})
                  },
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
            {showResponderNotice ? (
              <p className="evo-modal-hint sources-form-notice" role="note">
                {t("sources.form.credentialsNeedResponder")}
              </p>
            ) : (
              <p className="evo-modal-hint">{t("sources.form.passwordViaPrompt")}</p>
            )}
          </>
        ) : null}
        <label className="evo-modal-label">
          {t("sources.form.advanced")}
          <input
            className="evo-modal-input"
            type="text"
            placeholder="vers=3.1.1,noserverino"
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
