import type { PluginAdminItemPayload } from "./types";

export function canRemovePlugin(plugin: PluginAdminItemPayload): boolean {
  if (plugin.distribution_model === "bundled") {
    return false;
  }
  return true;
}

export function pluginPolicyHint(plugin: PluginAdminItemPayload): string {
  if (plugin.distribution_model === "bundled") {
    return "bundled plugin: remove blocked by policy";
  }
  if (plugin.trust_class === "self_attested") {
    return "self-attested plugin: removal allowed with caution";
  }
  return "policy checks passed";
}
