// SPDX-License-Identifier: GPL-2.0-or-later
// Layer copy and sharing's public API: what other extensions and ViaLink's
// keymap view may use (hook points, their events, and the operations behind
// paste and copy). Code outside the extension folders may import an
// extension's *.api.ts, never the extension module itself (ESLint, step 7).

import type { Keyboard } from "../keyboard.ts";
import { writeAll, type LayerWrite, type PasteMode } from "../layers.ts";
import { defineHook } from "./hooks.ts";

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
