// share-edit - what an Edit of a network share sends, and where a
// password typed on that dialog goes. Pure: no i18n, no DOM.
//
// Edit reuses the Add dialog. The field changes ride
// network.share.edit as a partial (only what the operator altered).
// The password does not: the plugin's ShareEdits has no password
// field and would drop it in silence. A typed password is stocked in
// the device vault under the key the share record will carry after
// the edit, through the framework's credential_put - the same op the
// file-sharing surface uses for an SMB user - before the edit is sent.
// Left blank, the vaulted secret stays.

import type { AddSharePayload, EditSharePayload } from "./useNetworkShares";
import type { ShareRecord } from "./share-decoders";

/** The plugin whose vault a share password lives in. */
export const SHARES_PLUGIN_ID = "org.evoframework.network.shares";

/** The vault key an Add mints for an alias. One definition: the dialog
 *  and the Edit path must never disagree on it. */
export function shareCredentialKey(alias: string): string {
  const slug = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `share.${slug}`;
}

/** Reduce a full form payload to the fields that actually changed vs the
 *  existing share, so network.share.edit only touches what the operator
 *  altered (credentials are only re-sent when kind/username/domain
 *  change). The password is never part of this payload. */
export function diffShareEdits(
  share: Pick<
    ShareRecord,
    "alias" | "fstype" | "host" | "path" | "advancedOptions" | "credentialsKind" | "username" | "domain"
  >,
  next: AddSharePayload
): EditSharePayload {
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

/** The vault key a password typed on Edit is stored under: the key the
 *  record will carry once the edit lands. Replaced credentials name
 *  their own key; unchanged credentials keep the record's; a record
 *  with no key yet (guest turned user+password) gets the Add-time slug
 *  of the alias being saved. */
export function passwordKeyForEdit(
  share: Pick<ShareRecord, "credentialKey">,
  edits: EditSharePayload,
  alias: string
): string {
  const c = edits.credentials;
  if (c !== undefined && c.kind === "user_password") return c.credential_key;
  return share.credentialKey ?? shareCredentialKey(alias);
}
