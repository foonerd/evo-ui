// system-info - the two reads on shelf system.info and their decoders.
//
// get_system_info answers the host: hostname, os, kernel, architecture,
// model, cpu { model, cores }, memory_total_bytes, uptime_s.
// get_system_version answers the installed release: release, build, the
// bundle's architecture, built_at_utc. Both take { v: 1 }. A fact the
// device does not provide answers null and is painted as unknown - never
// guessed.
//
// The software version is the installed release. It is never the version
// a runtime's health endpoint reports and never the build the plugin was
// compiled from: when the release is null, the software version is null.

export const SYSTEM_INFO_SHELF = "system.info";

export const SYSTEM_INFO_VERBS = {
  info: "get_system_info",
  version: "get_system_version"
} as const;

export const SYSTEM_INFO_PAYLOAD: Readonly<{ v: 1 }> = Object.freeze({ v: 1 });

export interface SystemInfo {
  hostname: string | null;
  os: string | null;
  kernel: string | null;
  /** The host's machine name. */
  architecture: string | null;
  model: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  memoryTotalBytes: number | null;
  /** Whole seconds since boot. */
  uptimeS: number | null;
}

export interface SystemVersion {
  /** The installed release, or null. */
  release: string | null;
  /** The version the plugin was compiled from. */
  build: string | null;
  /** The bundle's architecture. */
  architecture: string | null;
  builtAtUtc: string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function whole(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** The host as answered, or null when the answer is not an object. Each
 *  field that is null, missing or not its type is null. */
export function decodeSystemInfo(raw: unknown): SystemInfo | null {
  if (!isObject(raw)) return null;
  const cpu = isObject(raw["cpu"]) ? raw["cpu"] : {};
  return {
    hostname: str(raw, "hostname"),
    os: str(raw, "os"),
    kernel: str(raw, "kernel"),
    architecture: str(raw, "architecture"),
    model: str(raw, "model"),
    cpuModel: str(cpu, "model"),
    cpuCores: whole(cpu, "cores"),
    memoryTotalBytes: whole(raw, "memory_total_bytes"),
    uptimeS: whole(raw, "uptime_s")
  };
}

/** The installed release as answered, or null when the answer is not an
 *  object. */
export function decodeSystemVersion(raw: unknown): SystemVersion | null {
  if (!isObject(raw)) return null;
  return {
    release: str(raw, "release"),
    build: str(raw, "build"),
    architecture: str(raw, "architecture"),
    builtAtUtc: str(raw, "built_at_utc")
  };
}

/** The software version: the release, or null. Nothing else fills it. */
export function softwareVersion(version: SystemVersion | null): string | null {
  return version === null ? null : version.release;
}

/** Memory in GiB to two places, for the line that also shows the bytes. */
export function memoryGiB(bytes: number): string {
  return (bytes / 1073741824).toFixed(2);
}

/** Whole days, hours and minutes in an uptime of whole seconds, for the
 *  line that also shows the seconds. */
export function uptimeParts(seconds: number): { d: number; h: number; m: number } {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return { d, h, m };
}
