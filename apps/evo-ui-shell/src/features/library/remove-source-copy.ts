// remove-source-copy - what the Remove dialog says for a source kind.
//
// library.remove_source is one verb, { source_id }, for every kind. What
// it does differs by kind, and the dialog must say what will happen,
// not describe the card going away:
//
//   local_usb   the framework detaches the volume and prunes its
//               tracks - the drive becomes safe to unplug and its
//               tracks leave the library; nothing on the drive is
//               deleted
//   every other the source leaves the library; the underlying files
//               are not deleted (the existing sentence)
//
// The shell does not call safe_remove and never adds Force here.

import type { SourceKind } from "./library-decoders.ts";
import type { MessageKey } from "../../locales/en.ts";

export function removeSourceMessageKey(kind: SourceKind): MessageKey {
  return kind === "local_usb"
    ? "library.removeSourceMessageUsb"
    : "library.removeSourceMessage";
}
