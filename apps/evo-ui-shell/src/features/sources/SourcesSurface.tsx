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
import { useResponderGranted, reauthPromptResponder } from "../prompts/usePromptResponder";
import {
  hasNetworkAdmin,
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
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

function stateKey(state: ShareItem["state"]): string {
  return `sources.state.${state}`;
}

/** A verb refusal that pairing (a network_admin bearer) would resolve.
 *  We branch on the framework's structured subclass when present, and
 *  fall back to the shared auth-refusal vocabulary the network page uses. */
function isAuthRefusal(r: { message?: string; subclass?: string }): boolean {
  if (r.subclass === "step_up_required" || r.subclass === "pair_expired") {
    return true;
  }
  return /step.?up|scope|permission|denied|unauthori|not.?hold|network_admin|pair/i.test(
    r.message ?? ""
  );
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
  const admin = hasNetworkAdmin();
  // Adding a credentialed share raises a password prompt, and only the
  // session holding the responder role can RENDER it; without it the
  // framework would hold the mutation open for an answer this browser
  // can never show (root-caused live 2026-07-20). So the responder guard
  // stays ONLY on the credential-entry controls (add) - never on
  // mount/unmount/remove/refresh, and never as the network_admin dead-end
  // it used to be. network_admin is handled on-screen by pairing instead.
  const canPrompt = useResponderGranted();
  const [dialog, setDialog] = useState<SourcesDialog>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  // Set when a mutation is refused for want of network_admin (or a stale
  // bearer). We never DISABLE the controls for this - that was the
  // dead-end tooltip the operator hit before. Instead we surface the
  // on-screen "Pair this device" path, exactly like the network page.
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
      if (isAuthRefusal(r)) {
        // Elevation is handled by the inline pair notice - never dump a
        // raw scope/permission chain to the operator.
        setAuthRefused(true);
        setFeedback("");
      } else {
        setFeedback(friendlyVerbError(r.message));
      }
    } else {
      setAuthRefused(false);
    }
  };

  // network_admin is granted by pairing this device. When the session
  // hasn't paired (or a verb just refused for scope), we offer the
  // pairing ceremony ON this screen instead of dead-disabling the
  // buttons - matching the network page. Pairing here re-handshakes in
  // place (onPaired below), so admin AND the prompt responder light up
  // without a reload and the operator stays on Sources.
  const showAuthNotice = !admin || authRefused;
  // The responder role (also pairing-granted) is what lets THIS browser
  // render the framework's SMB password prompt. Only credential-entry
  // controls (add a share) actually raise that prompt, so only those
  // carry the guard - and the guidance is to pair, never a dead end.
  const promptLockTitle = canPrompt ? undefined : t("sources.needsResponder");

  return (
    <section className="card feature-surface sources-surface">
      <div className="feature-head">
        <div>
          <h3>{t("sources.title")}</h3>
          <p className="feature-description">{t("sources.description")}</p>
        </div>
        <button
          type="button"
          className="sources-refresh"
          disabled={busy || !canPrompt}
          title={promptLockTitle}
          onClick={() => setDialog({ kind: "add" })}
        >
          <Plus size={13} />
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
                      disabled={busy || !canPrompt}
                      title={promptLockTitle}
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
  onCancel,
  onSubmit
}: {
  /** When set, the form edits an existing share (pre-filled, full field
   *  parity incl. credentials + advanced options) instead of adding. */
  editShare?: ShareItem;
  prefillHost?: string;
  prefillPath?: string;
  availableShares?: string[];
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
  return (
    <Modal
      title={editShare ? t("sources.editShare", { alias: editShare.alias }) : t("sources.addShare")}
      onCancel={onCancel}
    >
      <form
        className="evo-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          // Vault key derived from the alias - the vault entry the
          // plugin resolves the password from. Stocking that entry
          // is the framework's promised prompt flow (not yet
          // implemented plugin-side; vault-miss renders on the card).
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
            <p className="evo-modal-hint">{t("sources.form.passwordViaPrompt")}</p>
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
            disabled={!valid}
          >
            {editShare ? t("sources.form.save") : t("sources.form.addAndMount")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
