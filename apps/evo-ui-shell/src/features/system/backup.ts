// backup - the two verbs on shelf system.backup, their payloads, the text
// the screen holds, and the decoders for what they answer.
//
// export_backup takes { v: 1 } and answers { v: 1, backup }; the backup is
// what the screen holds, as text the operator can copy, keep, and paste
// back. import_backup takes { v: 1, backup } with the backup on screen and
// answers { v: 1, refused: [{ domain, item, reason }] }; an empty list
// means every item went back. The glass adds nothing to a backup: the
// payload is the version and the backup, and a backup never carries the
// music files or a credential.

export const BACKUP_SHELF = "system.backup";

export const BACKUP_VERBS = {
  export: "export_backup",
  import: "import_backup"
} as const;

export type Backup = Record<string, unknown>;

export interface BackupRefusal {
  domain: string;
  item: string;
  reason: string;
}

export function exportBackupPayload(): { v: 1 } {
  return { v: 1 };
}

export function importBackupPayload(backup: Backup): { v: 1; backup: Backup } {
  return { v: 1, backup };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The text the screen holds for a backup. */
export function backupText(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/** The backup in the text on screen, or null when it does not parse to
 *  an object - nothing is sent. */
export function parseBackupText(text: string): Backup | null {
  if (text.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed : null;
}

/** The export answer's backup, or null when it carries none. */
export function decodeExportAnswer(raw: unknown): Backup | null {
  if (!isObject(raw)) return null;
  const b = raw["backup"];
  return isObject(b) ? b : null;
}

/** The import answer's refused list, or null when it is not one. */
export function decodeImportAnswer(raw: unknown): BackupRefusal[] | null {
  if (!isObject(raw)) return null;
  const list = raw["refused"];
  if (!Array.isArray(list)) return null;
  const out: BackupRefusal[] = [];
  for (const r of list) {
    if (!isObject(r)) return null;
    const domain = r["domain"];
    const item = r["item"];
    const reason = r["reason"];
    if (typeof domain !== "string" || typeof item !== "string" || typeof reason !== "string") return null;
    out.push({ domain, item, reason });
  }
  return out;
}
