// useSystemTimezone - the device's time zone on shelf system.locale.
//
// timezone.get and timezone.list are reads with no write grant: they ride
// this hook's anonymous seed socket. timezone.set is write:system_admin and
// rides the language / backup rule (./power-write-socket.ts): with a stored
// bearer, a private socket that presents it (read at every handshake,
// rotated by the bearer bus, closed on unmount); with no bearer, the seed
// socket. The seed socket is never given a bearer. Nothing here is the
// audio write path or the shared page socket, and the glass does not call
// the alarm: the device reschedules a pending alarm before it answers.

import { useCallback, useEffect, useRef } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { powerWriteSocket } from "./power-write-socket";
import {
  TIMEZONE_SHELF,
  TIMEZONE_VERBS,
  decodeTimezoneAnswer,
  decodeTimezoneList,
  timezoneReadPayload,
  timezoneSetPayload
} from "./timezone";

export type TimezoneResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; subclass: string | null };

export interface SystemTimezoneState {
  getTimezone: () => Promise<TimezoneResult<string>>;
  listTimezones: () => Promise<TimezoneResult<string[]>>;
  setTimezone: (name: string, list: ReadonlyArray<string> | null) => Promise<TimezoneResult<string>>;
}

function subclassOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const s = (error as Record<string, unknown>)["subclass"];
  return typeof s === "string" ? s : null;
}

export function useSystemTimezone(): SystemTimezoneState {
  const seedRef = useRef<WsTransport | null>(null);
  const writeRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    const off = onBearerChange(() => {
      const tx = writeRef.current;
      if (tx !== null) tx.rotateBearer();
    });
    return () => {
      off();
      const tx = writeRef.current;
      writeRef.current = null;
      if (tx !== null) void tx.close();
      const seed = seedRef.current;
      seedRef.current = null;
      if (seed !== null) void seed.close();
    };
  }, []);

  const seedTransport = useCallback((): WsTransport | null => {
    if (typeof WebSocket === "undefined") return null;
    let seed = seedRef.current;
    if (seed === null) {
      seed = new WsTransport({ url: frameworkWsUrl() });
      seedRef.current = seed;
    }
    return seed;
  }, []);

  const writeTransport = useCallback((): WsTransport | null => {
    if (powerWriteSocket(storedBearer() !== undefined) === "seed") {
      return seedTransport();
    }
    let tx = writeRef.current;
    if (tx === null) {
      // With a bearer stored, the set never falls back to the anonymous
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      writeRef.current = tx;
    }
    return tx;
  }, [seedTransport]);

  const getTimezone = useCallback(async (): Promise<TimezoneResult<string>> => {
    const transport = seedTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device.", subclass: null };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, TIMEZONE_SHELF, TIMEZONE_VERBS.get, timezoneReadPayload());
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), subclass: null };
    }
    if (r.error !== undefined) {
      return { ok: false, message: verbErrorMessage(r.error, "The zone could not be read."), subclass: subclassOf(r.error) };
    }
    const zone = decodeTimezoneAnswer(r.value);
    if (zone === null) return { ok: false, message: "The device named no zone.", subclass: null };
    return { ok: true, value: zone };
  }, [seedTransport]);

  const listTimezones = useCallback(async (): Promise<TimezoneResult<string[]>> => {
    const transport = seedTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device.", subclass: null };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, TIMEZONE_SHELF, TIMEZONE_VERBS.list, timezoneReadPayload());
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), subclass: null };
    }
    if (r.error !== undefined) {
      return { ok: false, message: verbErrorMessage(r.error, "The zone list could not be read."), subclass: subclassOf(r.error) };
    }
    const zones = decodeTimezoneList(r.value);
    if (zones === null) return { ok: false, message: "The device gave no zone list.", subclass: null };
    return { ok: true, value: zones };
  }, [seedTransport]);

  const setTimezone = useCallback(async (
    name: string,
    list: ReadonlyArray<string> | null
  ): Promise<TimezoneResult<string>> => {
    const payload = timezoneSetPayload(name, list);
    if (payload === null) {
      return { ok: false, message: "That zone is not one the device offered.", subclass: null };
    }
    const transport = writeTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device.", subclass: null };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, TIMEZONE_SHELF, TIMEZONE_VERBS.set, payload);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), subclass: null };
    }
    if (r.error !== undefined) {
      return {
        ok: false,
        message: verbErrorMessage(r.error, "The device did not set the zone."),
        subclass: subclassOf(r.error)
      };
    }
    const zone = decodeTimezoneAnswer(r.value);
    if (zone === null) return { ok: false, message: "The device named no zone.", subclass: null };
    return { ok: true, value: zone };
  }, [writeTransport]);

  return { getTimezone, listTimezones, setTimezone };
}
