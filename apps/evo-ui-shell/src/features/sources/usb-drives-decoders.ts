// usb-drives-decoders - wire shapes for the storage.usb shelf.
//
//   storage.usb.list_drives -> ListDrivesEnvelope
//   storage_usb_drives subject -> same envelope
//   { v, drives: [DriveRecord], last_update_at_ms }
//
// DriveRecord + the DriveClass / IdSource unions are normative in
// plugins/org.evoframework.storage.usb/docs/USB-STORAGE.md sections 5 + 10.
// Every optional wire field is null-safe here; the surface renders its
// honest not-yet state when a field is absent.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  return isObject(raw["envelope"])
    ? (raw["envelope"] as Record<string, unknown>)
    : raw;
}

/** Which derivation rule produced the drive's base id (drives the
 *  "how did I get this name?" tooltip). */
export type UsbIdSource =
  | "operator_alias"
  | "fs_label"
  | "vendor_model"
  | "model_only"
  | "synthesized";

/** Lifecycle + mountability class - drives the per-row affordances. */
export type UsbDriveClass =
  | "system-disk"
  | "unsupported"
  | "unmounted"
  | "mounted-clean"
  | "mounted-dirty"
  | "mounted-dirty-hiberfile"
  | "mount-failed-dirty"
  | "mount-failed-oversized-vfat"
  | "mount-failed-other";

export interface UsbDrive {
  stableId: string;
  displayName: string;
  idSource: UsbIdSource | null;
  deviceNode: string;
  parentDisk: string;
  partitionIndex: number;
  partitionCount: number;
  label: string | null;
  uuid: string | null;
  partuuid: string | null;
  vendor: string | null;
  model: string | null;
  serialShort: string | null;
  fsType: string;
  sizeBytes: number;
  /** "system-root" | "system-boot" | ... | "removable". */
  role: string | null;
  /** "auto" | "opt-in-required" | "refused-system-live". */
  mountPolicy: string | null;
  driveClass: UsbDriveClass;
  mountRoot: string | null;
  librarySourceId: string | null;
  aliasSet: boolean;
  lastTransitionAtMs: number | null;
}

export interface UsbDriveSet {
  drives: UsbDrive[];
  lastUpdateAtMs: number | null;
}

const ID_SOURCES: ReadonlySet<string> = new Set([
  "operator_alias",
  "fs_label",
  "vendor_model",
  "model_only",
  "synthesized"
]);
const DRIVE_CLASSES: ReadonlySet<string> = new Set([
  "system-disk",
  "unsupported",
  "unmounted",
  "mounted-clean",
  "mounted-dirty",
  "mounted-dirty-hiberfile",
  "mount-failed-dirty",
  "mount-failed-oversized-vfat",
  "mount-failed-other"
]);

function decodeDrive(raw: unknown): UsbDrive | null {
  if (!isObject(raw)) return null;
  const stableId = str(raw, "stable_id");
  const deviceNode = str(raw, "device_node");
  const cls = str(raw, "class");
  if (stableId === null || deviceNode === null || cls === null) return null;
  const driveClass: UsbDriveClass = DRIVE_CLASSES.has(cls)
    ? (cls as UsbDriveClass)
    : "mount-failed-other";
  const idSourceRaw = str(raw, "id_source");
  const idSource: UsbIdSource | null =
    idSourceRaw !== null && ID_SOURCES.has(idSourceRaw)
      ? (idSourceRaw as UsbIdSource)
      : null;
  return {
    stableId,
    // display_name is meant to always be present; fall back to the
    // stable id so a row never renders nameless.
    displayName: str(raw, "display_name") ?? stableId,
    idSource,
    deviceNode,
    parentDisk: str(raw, "parent_disk") ?? deviceNode,
    partitionIndex: num(raw, "partition_index") ?? 1,
    partitionCount: num(raw, "partition_count") ?? 1,
    label: str(raw, "label"),
    uuid: str(raw, "uuid"),
    partuuid: str(raw, "partuuid"),
    vendor: str(raw, "vendor"),
    model: str(raw, "model"),
    serialShort: str(raw, "serial_short"),
    fsType: str(raw, "fs_type") ?? "unsupported",
    sizeBytes: num(raw, "size_bytes") ?? 0,
    role: str(raw, "role"),
    mountPolicy: str(raw, "mount_policy"),
    driveClass,
    mountRoot: str(raw, "mount_root"),
    librarySourceId: str(raw, "library_source_id"),
    aliasSet: raw["alias_set"] === true,
    lastTransitionAtMs:
      num(raw, "last_transition_at_ms") ?? num(raw, "last_transition_at")
  };
}

export function decodeUsbDrives(raw: unknown): UsbDriveSet | null {
  const b = unwrap(raw);
  if (b === null || !Array.isArray(b["drives"])) return null;
  const drives: UsbDrive[] = [];
  for (const d of b["drives"]) {
    const decoded = decodeDrive(d);
    if (decoded !== null) drives.push(decoded);
  }
  return {
    drives,
    lastUpdateAtMs: num(b, "last_update_at_ms")
  };
}

export function decodeUsbDrivesHappening(raw: unknown): UsbDriveSet | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"])
    ? (raw["happening"] as Record<string, unknown>)
    : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "storage_usb_drives") return null;
  return decodeUsbDrives(frame["new_state"]);
}

/** Structured fields lifted off a verb refusal so the surface can render
 *  them (busy holders, oversized cap, colliding id) rather than only a
 *  prose message. All null-safe - a refusal that omits them still shows
 *  its message. */
export interface UsbRefuseData {
  /** Busy: ["<pid>:<comm>", ...] processes holding the mount open. */
  holders: string[];
  /** MountFailedOversizedVfat: the drive size + the FAT32 cap. */
  sizeBytes: number | null;
  capBytes: number | null;
  /** AliasWouldCollide: the stable_id already using the requested name. */
  collidingStableId: string | null;
}

export function usbRefuseData(error: unknown): UsbRefuseData {
  const out: UsbRefuseData = {
    holders: [],
    sizeBytes: null,
    capBytes: null,
    collidingStableId: null
  };
  if (!isObject(error)) return out;
  // The framework may nest the structured payload under `data` or place
  // the fields on the error object directly - accept both.
  const d = isObject(error["data"]) ? (error["data"] as Record<string, unknown>) : error;
  if (Array.isArray(d["holders"])) {
    out.holders = d["holders"].filter((h): h is string => typeof h === "string");
  }
  out.sizeBytes = num(d, "size_bytes");
  out.capBytes = num(d, "cap_bytes");
  out.collidingStableId = str(d, "colliding_stable_id");
  return out;
}
