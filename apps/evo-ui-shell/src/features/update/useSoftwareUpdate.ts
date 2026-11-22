// useSoftwareUpdate - the update-source check that runs when the operator
// opens Software update, and only then.
//
// The registries are listed first (list_plugin_registries, a read on an
// anonymous socket). An evo-audio- registry is the operator's channel and
// is left alone. Otherwise the host architecture is read
// (get_system_info) and, for a known triple, evo-audio-prod is registered
// through the existing step-up dispatch: plugins_admin
// .registerPluginRegistry on a socket chosen by the step-up bearer rule
// (./power-write-socket.ts). If the steward asks for elevation, the one
// operator-password card comes up from that dispatch; a cancel or a refusal
// returns the refusal, nothing is registered, and this view shows it - the
// glass does not send again. One check runs at a time, app-wide; a view
// that opens while one runs shows its progress. The check closes its own
// sockets when it ends, so a confirm on the card still completes if the
// operator leaves the view. After a confirmed register the same write
// socket refreshes that registry once (a write, not step-up), and only
// then is the source shown as registered.

import { useEffect, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { storedBearer } from "../../runtime/bearer";
import { PluginsModule } from "../../sdk/modules/plugins";
import { PluginsAdminModule } from "../../sdk/modules/plugins_admin";
import { powerWriteSocket } from "../system/power-write-socket";
import {
  SYSTEM_INFO_PAYLOAD,
  SYSTEM_INFO_SHELF,
  SYSTEM_INFO_VERBS,
  decodeSystemInfo
} from "../system/system-info";
import {
  audioProdRegistration,
  audioRegistrySlugs,
  decodeRefreshed,
  decodeRegistered,
  decodeRegistrySlugs,
  refreshRegistryPayload,
  targetTriple
} from "./software-update";

export type UpdatePhase =
  | { kind: "checking" }
  | { kind: "present"; slugs: string[] }
  | { kind: "listFailed"; message: string }
  | { kind: "noTriple"; architecture: string | null }
  | { kind: "registering" }
  | { kind: "registered"; slug: string }
  | { kind: "refused"; message: string };

let running: Promise<void> | null = null;
let lastPhase: UpdatePhase = { kind: "checking" };
const listeners = new Set<(p: UpdatePhase) => void>();

function publish(p: UpdatePhase): void {
  lastPhase = p;
  for (const l of listeners) l(p);
}

async function runCheck(): Promise<void> {
  // The sockets this check opens; closed when it ends.
  const sockets: { seed: WsTransport | null; write: WsTransport | null } = { seed: null, write: null };
  const seedTransport = (): WsTransport => {
    if (sockets.seed === null) sockets.seed = new WsTransport({ url: frameworkWsUrl() });
    return sockets.seed;
  };
  const writeTransport = (): WsTransport | null => {
    if (powerWriteSocket(storedBearer() !== undefined) === "seed") {
      return seedTransport();
    }
    if (sockets.write === null) {
      sockets.write = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
    }
    return sockets.write;
  };
  const check = async (): Promise<void> => {
    publish({ kind: "checking" });
    const seed = seedTransport();
    const listed = await new PluginsModule(seed).listPluginRegistries();
    const slugs = listed.error === undefined ? decodeRegistrySlugs(listed.value) : null;
    if (slugs === null) {
      publish({
        kind: "listFailed",
        message: listed.error !== undefined
          ? verbErrorMessage(listed.error, "The update sources could not be read.")
          : "The update sources could not be read."
      });
      return;
    }
    const present = audioRegistrySlugs(slugs);
    if (present.length > 0) {
      publish({ kind: "present", slugs: present });
      return;
    }
    const info = await pluginRequest(seed, SYSTEM_INFO_SHELF, SYSTEM_INFO_VERBS.info, SYSTEM_INFO_PAYLOAD);
    const architecture = info.error === undefined ? decodeSystemInfo(info.value)?.architecture ?? null : null;
    const triple = targetTriple(architecture);
    if (triple === null) {
      publish({ kind: "noTriple", architecture });
      return;
    }
    const write = writeTransport();
    if (write === null) {
      publish({ kind: "refused", message: "Not connected to the device." });
      return;
    }
    publish({ kind: "registering" });
    const r = await new PluginsAdminModule(write).registerPluginRegistry(audioProdRegistration(triple));
    if (r.error !== undefined) {
      publish({ kind: "refused", message: verbErrorMessage(r.error, "The update source was not registered.") });
      return;
    }
    const slug = decodeRegistered(r.value);
    if (slug === null) {
      publish({ kind: "refused", message: "The device did not confirm the update source." });
      return;
    }
    // A register alone lives in the steward's memory; the refresh, on the
    // same write socket, is what keeps it. It is a write, not step-up: no
    // second card. A failed refresh is shown as it is - the registry is
    // not unregistered and nothing is sent again.
    const f = await new PluginsAdminModule(write).refreshPluginRegistry(refreshRegistryPayload(slug));
    if (f.error !== undefined) {
      publish({ kind: "refused", message: verbErrorMessage(f.error, "The update source was registered but not refreshed.") });
      return;
    }
    if (decodeRefreshed(f.value) !== slug) {
      publish({ kind: "refused", message: "The device did not confirm the update source refresh." });
      return;
    }
    publish({ kind: "registered", slug });
  };
  try {
    await check();
  } catch (err) {
    publish({ kind: "refused", message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (sockets.seed !== null) void sockets.seed.close();
    if (sockets.write !== null) void sockets.write.close();
  }
}

export function useSoftwareUpdate(): { phase: UpdatePhase } {
  const [phase, setPhase] = useState<UpdatePhase>(lastPhase);
  useEffect(() => {
    listeners.add(setPhase);
    if (running === null) {
      if (typeof WebSocket === "undefined") {
        publish({ kind: "listFailed", message: "Not connected to the device." });
      } else {
        running = runCheck().finally(() => {
          running = null;
        });
      }
    } else {
      setPhase(lastPhase);
    }
    return () => {
      listeners.delete(setPhase);
    };
  }, []);
  return { phase };
}
