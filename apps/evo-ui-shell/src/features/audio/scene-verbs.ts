// scene-verbs - the four scene verbs on shelf audio.zones, their payload,
// the decoders for what they answer, and the ways an answer becomes the
// scene list on screen.
//
// A scene is a name and a snapshot of every zone - id, name, membership
// and stored EQ. It holds nothing else and it does not play. The list is
// asked with { v } and nothing else and shown in the answer's order; an
// empty answer is an empty list. Save, recall and remove each send
// { name } and nothing else; an empty trimmed name is never sent. Each of
// the three answers the scene it stored, recalled or took away. Names
// match without regard to case, as the plugin matches them.
//
// The zones a recall answers are decoded with the zone decoder; a scene
// whose zones do not all decode is not a scene, so the glass paints
// nothing from it.

import { decodeZone, type Zone } from "./zone-verbs.ts";

export const SCENE_VERBS = {
  list: "scene.list",
  save: "scene.save",
  recall: "scene.recall",
  remove: "scene.remove"
} as const;

/** One scene as the plugin answers it. */
export interface Scene {
  name: string;
  /** Every zone as it was when the scene was saved, in the snapshot's
   *  order. */
  zones: Zone[];
}

export type SceneNamePayload = { name: string };

/** The payload for save, recall and remove: the trimmed name, or null
 *  when it is empty - nothing is sent. */
export function sceneNamePayload(name: string): SceneNamePayload | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return { name: trimmed };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The answer to the list: { v, scenes: [string] }, in the answer's
 *  order. Anything that is not a name is left out; no list is an empty
 *  list. */
export function decodeSceneList(raw: unknown): string[] {
  if (!isObject(raw)) return [];
  const names = raw["scenes"];
  if (!Array.isArray(names)) return [];
  return names.filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** The answer to save, recall and remove: { v, scene: { name, zones } }.
 *  Null - a refusal - when the scene has no name, no zones list, or any
 *  zone that does not decode. */
export function decodeSceneAnswer(raw: unknown): Scene | null {
  if (!isObject(raw)) return null;
  const s = raw["scene"];
  if (!isObject(s)) return null;
  const name = s["name"];
  if (typeof name !== "string" || name.length === 0) return null;
  const zonesRaw = s["zones"];
  if (!Array.isArray(zonesRaw)) return null;
  const zones: Zone[] = [];
  for (const z of zonesRaw) {
    const zone = decodeZone(z);
    if (zone === null) return null;
    zones.push(zone);
  }
  return { name, zones };
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** After save: a name already listed, without regard to case, is
 *  replaced in place with the answer's spelling; a new name is appended. */
export function withSceneSaved(names: ReadonlyArray<string>, scene: Scene): string[] {
  const at = names.findIndex((n) => sameName(n, scene.name));
  if (at < 0) return [...names, scene.name];
  return names.map((n, i) => (i === at ? scene.name : n));
}

/** After remove: the list without that name, without regard to case. */
export function withSceneRemoved(names: ReadonlyArray<string>, scene: Scene): string[] {
  return names.filter((n) => !sameName(n, scene.name));
}

/** After recall: the names as they were. */
export function withSceneRecalled(names: ReadonlyArray<string>, _scene: Scene): string[] {
  return [...names];
}
