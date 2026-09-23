// Pure state helpers for the Input toggles (on-screen keyboard + mouse
// pointer). Kept free of any preact / transport import so the contract
// harness can exercise them directly (kiosk-remote.ts pulls in the
// framework transport).

import { isHouseholdLocked } from "../../runtime/authz-classify.ts";

/** Verdict for a kiosk display/touch write outcome. The panel keys its
 *  surfacing off this: "locked" shows the household notice + door (a real
 *  household_policy_locked refusal), "blocked" is the honest player-side
 *  "controls not in place" banner, "ok" clears both. Pure so the lie-fix
 *  (locked must NOT read as unavailable) carries a regression guard. */
export type KioskWriteVerdict = "ok" | "locked" | "blocked";

export function classifyKioskWrite(res: {
  ok: boolean;
  subclass?: string;
}): KioskWriteVerdict {
  if (res.ok) return "ok";
  return isHouseholdLocked({ subclass: res.subclass }) ? "locked" : "blocked";
}

/** Lift the derived calibration out of a derive_touch_calibration_from_
 *  corners response body. Returns null when any field is missing or the
 *  wrong type - the wizard then reports a failure rather than showing a
 *  triple it invented. Pure, so the contract harness can exercise it. */
export interface DerivedCalibration {
  rotation: "0" | "90" | "180" | "270";
  hflip: boolean;
  vflip: boolean;
  /** Mean per-sample residual, [0,1]. Near 0 is a clean fit. */
  meanError: number;
}

export function readDerivedCalibration(
  value: Record<string, unknown> | undefined
): DerivedCalibration | null {
  if (value === undefined) return null;
  const r = value.touch_rotation;
  if (r !== "0" && r !== "90" && r !== "180" && r !== "270") return null;
  const h = value.touch_hflip;
  const v = value.touch_vflip;
  const m = value.mean_error;
  if (typeof h !== "boolean" || typeof v !== "boolean") return null;
  if (typeof m !== "number" || !Number.isFinite(m)) return null;
  return { rotation: r, hflip: h, vflip: v, meanError: m };
}

/** Read a boolean toggle key from a get_display_state payload: the boolean
 *  when present, else null (key absent = a player on the old verb). NEVER
 *  defaults - the panel keys "row disabled" off null so it cannot invent On. */
export function readBoolKey(
  o: Record<string, unknown>,
  key: string
): boolean | null {
  return typeof o[key] === "boolean" ? (o[key] as boolean) : null;
}

/** osk_enabled: boolean when present, else null (old verb -> row disabled). */
export function readOskEnabled(o: Record<string, unknown>): boolean | null {
  return readBoolKey(o, "osk_enabled");
}

/** cursor_visible: boolean when present, else null (old verb -> row disabled). */
export function readCursorVisible(o: Record<string, unknown>): boolean | null {
  return readBoolKey(o, "cursor_visible");
}

/** Resolve a device toggle after a write: keep the attempted value on
 *  success, revert to the previous value on refusal - so a refused write
 *  never leaves a sticky lie in the UI or the evo.kiosk.* cache. Shared by
 *  the on-screen-keyboard and mouse-pointer rows. */
export function toggleAfterWrite(
  prev: boolean,
  attempted: boolean,
  ok: boolean
): boolean {
  return ok ? attempted : prev;
}

/** What the brightness slider shows once a write has settled.
 *
 *  Brightness echoes live while the finger drags (the thumb must track
 *  it), so the write is sent with the echo already painted. The player
 *  is the truth: a write it did not take ("locked" / "blocked") puts the
 *  slider back to the last value it held - the seed from
 *  get_display_state, or the last write it accepted. An accepted write
 *  becomes the new held value. */
export function brightnessAfterSettle(
  verdict: KioskWriteVerdict,
  attempted: number,
  held: number
): { show: number; held: number } {
  return verdict === "ok"
    ? { show: attempted, held: attempted }
    : { show: held, held };
}

/** Which socket a kiosk WRITE rides. A stored kiosk / pair bearer must be
 *  presented on the write - the shared page socket is anonymous
 *  LAN-trust and is never given a bearer, so a paired browser's writes
 *  would otherwise keep riding an identity it has outgrown (and a
 *  step-up sitting bound to the bearer could never be spent there).
 *  Reads stay on the shared socket either way. Same rule as the
 *  household set's write socket. */
export type KioskWriteSocket = "shared" | "stored-bearer";

export function kioskWriteSocket(hasStoredBearer: boolean): KioskWriteSocket {
  return hasStoredBearer ? "stored-bearer" : "shared";
}

/** Bound on the wizard's reset and derive writes. An unsettled
 *  pluginRequest used to leave the overlay on Preparing / Calculating
 *  until Cancel. The transport unparks on this signal; the race below
 *  still leaves the spinner if the transport ignores it. */
export const KIOSK_CAL_WRITE_DEADLINE_MS = 15_000;

export function abortedKioskCalWrite(): { ok: false; message: "aborted" } {
  return { ok: false, message: "aborted" };
}

/** Settle a wizard write when the work returns, rejects, or the
 *  deadline aborts. Classify the aborted shape as blocked. */
export function settleKioskCalWrite<T extends { ok: boolean }>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T | { ok: false; message: "aborted" }> {
  if (signal.aborted) {
    return Promise.resolve(abortedKioskCalWrite());
  }
  return new Promise((resolve) => {
    const finish = (value: T | { ok: false; message: "aborted" }): void => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      finish(abortedKioskCalWrite());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(
      (res) => finish(res),
      () => finish(abortedKioskCalWrite())
    );
  });
}
