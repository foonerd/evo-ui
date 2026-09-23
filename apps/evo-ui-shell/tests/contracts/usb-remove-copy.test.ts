// Contract: the USB Remove dialog does not describe a hide.
//
// Field failure: the Library's Remove dialog said the same thing for
// every source - "Remove from the library? The underlying files are
// not deleted." For a stick that is hide-the-card language: the
// framework's remove_source on a local_usb source detaches the volume
// and prunes its tracks, so the operator is being told the card goes
// away when the drive is in fact being made safe to unplug and its
// tracks leave the library. Now a local_usb target gets copy that
// says exactly that; every other kind keeps the existing sentence. The
// verb stays library.remove_source { source_id }: no safe_remove from
// the shell, no Force.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { removeSourceMessageKey } from "../../src/features/library/remove-source-copy.ts";
import { en } from "../../src/locales/en.ts";
import type { SourceKind } from "../../src/features/library/library-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const surface = src("features/library/LibrarySurface.tsx");
const hook = src("features/library/useLibrary.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const HIDE_SENTENCE = 'Remove "{name}" from the library? The underlying files are not deleted.';

test("local_usb does not use the hide sentence", () => {
  assert.equal(removeSourceMessageKey("local_usb"), "library.removeSourceMessageUsb");
  const usb = en["library.removeSourceMessageUsb"];
  assert.notEqual(usb, HIDE_SENTENCE);
  assert.ok(/safe to unplug/.test(usb), "says the volume will be safe to unplug");
  assert.ok(/leave the library/.test(usb), "says the tracks leave the library");
  assert.ok(/\{name\}/.test(usb), "names the source");
  assert.ok(/^[\x20-\x7E]+$/.test(usb), "7-bit");
  // The dialog picks by the target's kind and still names it.
  const dialog = between(surface, "{removeTarget !== null ? (", "onConfirm={() => {");
  assert.ok(
    /message=\{t\(removeSourceMessageKey\(removeTarget\.kind\), \{\s*name: removeTarget\.displayName\s*\}\)\}/.test(dialog),
    "the dialog copy is picked by kind"
  );
  assert.ok(!/library\.removeSourceMessage"/.test(dialog), "no hard-wired generic key in the dialog");
});

test("other kinds keep the existing sentence", () => {
  const others: SourceKind[] = [
    "local_internal",
    "network_nas_smb",
    "network_nas_nfs",
    "network_dlna",
    "cloud_gdrive",
    "cloud_onedrive",
    "other"
  ];
  for (const kind of others) {
    assert.equal(removeSourceMessageKey(kind), "library.removeSourceMessage", kind);
  }
  assert.equal(en["library.removeSourceMessage"], HIDE_SENTENCE, "the generic sentence is byte-identical");
  assert.equal(en["library.removeSourceTitle"], "Remove source");
});

test("the verb stays { source_id }: no safe_remove, no Force from the shell", () => {
  assert.ok(/dispatch\("library\.remove_source", \{ source_id: sourceId \}\)/.test(hook), "useLibrary.removeSource unchanged");
  const remove = between(surface, "{removeTarget !== null ? (", "    </div>\n  );\n}");
  assert.ok(/const r = await library\.removeSource\(target\.id\);/.test(remove), "the dialog confirms through the same verb");
  assert.ok(!/safe_remove|safeRemove|force/i.test(remove), "no safe_remove, no Force");
  assert.ok(/confirmLabel=\{t\("library\.remove"\)\}/.test(remove) && /destructive/.test(remove), "the same button, still destructive");
});
