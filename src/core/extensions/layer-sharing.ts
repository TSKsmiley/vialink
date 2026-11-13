// SPDX-License-Identifier: GPL-2.0-or-later
// "Layer copy and sharing": copy, paste, duplicate, swap and clear layers, and
// share a layer as a line of text (src/core/layers.ts, src/core/layer-share.ts).
// A ViaLink extra that works with standard Vial firmware: it only uses the
// standard keymap commands, so the probe never talks to the board. It is an
// extension so it can be turned off in the Extensions dialog, and so others can
// join in through its two hook points:
// - layer-sharing.paste: paste, duplicate and paste from text, as one
//   operation (before/filter/after; layer names names the target);
// - layer-sharing.share-text: extensions add their own data to a copied layer
//   (in-app copy and share text), read back as the paste event's `ext`.

import type { Keyboard } from "../keyboard.ts";
import { writeAll, type LayerWrite, type PasteMode } from "../layers.ts";
import { defineHook } from "./hooks.ts";
import type { KeyboardExtension } from "./types.ts";

export interface PasteEvent {
  /** Where the keys come from. */
  readonly source: "copy" | "duplicate" | "text";
  readonly target: number;
  readonly mode: PasteMode;
  /** The name to give the target, as the user chose in the preview; null to leave names alone. */
  readonly name: string | null;
  /** Extensions' data copied with the layer (share-text hook), by extension id. */
  readonly ext: Readonly<Record<string, unknown>>;
}

export interface ShareTextEvent {
  /** The layer being copied. */
  readonly layer: number;
  /** Stores this extension's data with the copy (under its own id). */
  put(value: unknown): void;
}

export const paste = defineHook<PasteEvent, readonly LayerWrite[]>("layer-sharing.paste");
export const shareText = defineHook<ShareTextEvent>("layer-sharing.share-text");

/** Pastes `writes` onto `event.target` as one undo step, through the {@link paste} hook point. */
export function pasteLayer(kb: Keyboard, event: PasteEvent, writes: readonly LayerWrite[], label: string) {
  return kb.runOperation(paste, event, writes, label, (plan) => writeAll(kb, event.target, plan));
}

/** Extensions' data to copy along with `layer`, by extension id ({@link shareText} hook). */
export function shareData(kb: Keyboard, layer: number): Promise<Record<string, unknown>> {
  return kb.collect(shareText, (put) => ({ layer, put }));
}

export const layerSharingExtension: KeyboardExtension<Record<string, never>> = {
  id: "layer-sharing",
  group: "compatible",
  provides: [paste, shareText],
  name: "Layer copy and sharing",
  description:
    "Copy, paste, duplicate and swap layers, and share a layer as a line of text that a friend can paste onto the same kind of keyboard, even with other layout options.",
  async probe() {
    return {};
  },
};
