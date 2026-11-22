// useSystemInfo - About's reads of the host and the installed release.
//
// Two reads on shelf system.info through pluginRequest on the shared
// page-lifetime socket (the socket the kiosk display read uses), each with
// { v: 1 }, once when About is shown. They are reads: no private socket, no
// bearer, no write path. A refused read changes nothing, so About keeps
// what it is already showing. Without the shared socket (a designer or a
// test mounting the panel alone) nothing is read.

import { useEffect, useState } from "preact/hooks";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import {
  SYSTEM_INFO_PAYLOAD,
  SYSTEM_INFO_SHELF,
  SYSTEM_INFO_VERBS,
  decodeSystemInfo,
  decodeSystemVersion,
  type SystemInfo,
  type SystemVersion
} from "./system-info";

export interface SystemInfoState {
  info: SystemInfo | null;
  version: SystemVersion | null;
}

export function useSystemInfo(): SystemInfoState {
  const transport = tryUseFrameworkTransport();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [version, setVersion] = useState<SystemVersion | null>(null);

  useEffect(() => {
    if (transport === null) return undefined;
    let cancelled = false;
    void (async () => {
      const r = await pluginRequest(transport, SYSTEM_INFO_SHELF, SYSTEM_INFO_VERBS.info, SYSTEM_INFO_PAYLOAD);
      if (cancelled || r.error !== undefined) return;
      const decoded = decodeSystemInfo(r.value);
      if (decoded !== null) setInfo(decoded);
    })();
    void (async () => {
      const r = await pluginRequest(transport, SYSTEM_INFO_SHELF, SYSTEM_INFO_VERBS.version, SYSTEM_INFO_PAYLOAD);
      if (cancelled || r.error !== undefined) return;
      const decoded = decodeSystemVersion(r.value);
      if (decoded !== null) setVersion(decoded);
    })();
    return () => {
      cancelled = true;
    };
  }, [transport]);

  return { info, version };
}
