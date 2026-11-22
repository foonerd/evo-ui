// useSystemBackup - export_backup and import_backup on shelf system.backup.
//
// Both verbs are system-admin gated, like reboot_device, and ride the same
// rule (./power-write-socket.ts): with a stored bearer they go out on a
// private socket that presents it (read at every handshake, rotated by the
// bearer bus, closed on unmount); with no bearer they stay on this hook's
// anonymous seed socket. The seed socket is never given a bearer. Neither
// verb is the audio write path, and neither touches the shared page
// socket. Both sockets open on the first send and close on unmount.

import { useCallback, useEffect, useRef } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { powerWriteSocket } from "./power-write-socket";
import {
  BACKUP_SHELF,
  BACKUP_VERBS,
  decodeExportAnswer,
  decodeImportAnswer,
  exportBackupPayload,
  importBackupPayload,
  type Backup,
  type BackupRefusal
} from "./backup";

export type BackupResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface SystemBackupState {
  exportBackup: () => Promise<BackupResult<Backup>>;
  importBackup: (backup: Backup) => Promise<BackupResult<BackupRefusal[]>>;
}

export function useSystemBackup(): SystemBackupState {
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
      // With a bearer stored, a verb never falls back to the anonymous
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      writeRef.current = tx;
    }
    return tx;
  }, [seedTransport]);

  const exportBackup = useCallback(async (): Promise<BackupResult<Backup>> => {
    const transport = writeTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device." };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, BACKUP_SHELF, BACKUP_VERBS.export, exportBackupPayload());
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (r.error !== undefined) {
      return { ok: false, message: verbErrorMessage(r.error, "The device refused the export.") };
    }
    const backup = decodeExportAnswer(r.value);
    if (backup === null) return { ok: false, message: "The device answered with no backup." };
    return { ok: true, value: backup };
  }, [writeTransport]);

  const importBackup = useCallback(async (backup: Backup): Promise<BackupResult<BackupRefusal[]>> => {
    const transport = writeTransport();
    if (transport === null) return { ok: false, message: "Not connected to the device." };
    let r: Awaited<ReturnType<typeof pluginRequest>>;
    try {
      r = await pluginRequest(transport, BACKUP_SHELF, BACKUP_VERBS.import, importBackupPayload(backup));
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (r.error !== undefined) {
      return { ok: false, message: verbErrorMessage(r.error, "The device refused the import.") };
    }
    const refused = decodeImportAnswer(r.value);
    if (refused === null) return { ok: false, message: "The device answered the import with nothing the glass can show." };
    return { ok: true, value: refused };
  }, [writeTransport]);

  return { exportBackup, importBackup };
}
