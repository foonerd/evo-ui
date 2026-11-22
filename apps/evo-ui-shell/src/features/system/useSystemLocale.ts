// useSystemLocale - language.set on shelf system.locale.
//
// The verb rides the same rule as the backup verbs
// (./power-write-socket.ts): with a stored bearer it goes out on a private
// socket that presents it (read at every handshake, rotated by the bearer
// bus, closed on unmount); with no bearer it stays on this hook's anonymous
// seed socket. The seed socket is never given a bearer. It is not the audio
// write path and never the shared page socket. It never writes ui.locale.

import { useCallback, useEffect, useRef } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { powerWriteSocket } from "./power-write-socket";
import { LANGUAGE_VERB, LOCALE_SHELF, decodeLanguageAnswer, languagePayload } from "./language";

export type LanguageResult = { ok: true; value: string } | { ok: false; message: string };

export interface SystemLocaleState {
  /** Send language.set for an offered tag; the value is the language the
   *  answer names. */
  setLanguage: (tag: string) => Promise<LanguageResult>;
}

export function useSystemLocale(): SystemLocaleState {
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
      // With a bearer stored, the verb never falls back to the anonymous
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      writeRef.current = tx;
    }
    return tx;
  }, [seedTransport]);

  const setLanguage = useCallback(async (tag: string): Promise<LanguageResult> => {
    const payload = languagePayload(tag);
    if (payload === null) {
      return { ok: false, message: "That language is not offered on this device." };
    }
    const transport = writeTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device." };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, LOCALE_SHELF, LANGUAGE_VERB, payload);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (r.error !== undefined) {
      return { ok: false, message: verbErrorMessage(r.error, "The device refused the language.") };
    }
    const language = decodeLanguageAnswer(r.value);
    if (language === null) return { ok: false, message: "The device answered with no language." };
    return { ok: true, value: language };
  }, [writeTransport]);

  return { setLanguage };
}
