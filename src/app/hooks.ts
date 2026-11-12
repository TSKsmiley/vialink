// SPDX-License-Identifier: GPL-2.0-or-later
import { useSyncExternalStore } from "react";
import { layerNamesExtension } from "../core/extensions/layerNames.ts";
import { tapDanceExtension } from "../core/extensions/tap-dance.ts";
import type { Keyboard } from "../core/keyboard.ts";
import type { PickerInfo } from "./components/KeycodePicker.tsx";

/** Re-renders whenever the keyboard's state changes; returns its version counter. */
export function useKeyboardVersion(kb: Keyboard | null): number {
  return useSyncExternalStore(
    (cb) => (kb ? kb.subscribe(cb) : () => undefined),
    () => kb?.version ?? 0,
  );
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A safe .vil file name for a keyboard or layout name. */
export function fileNameFor(name: string): string {
  return `${(name || "keyboard").replace(/[^\w-]+/g, "_")}.vil`;
}

/** What the keycode picker shows about this board beyond the keycodes themselves. */
export function pickerInfoOf(keyboard: Keyboard): PickerInfo {
  const table = keyboard.keycodes;
  const trns = table.parse("KC_TRNS");
  const isUsed = (code: number | undefined) => code !== undefined && code !== 0 && code !== trns;
  const usedLayers = new Set<number>();
  for (let layer = 0; layer < keyboard.layers; layer++) {
    const keys = keyboard.keys.some((k) => isUsed(keyboard.getKey(layer, k.row, k.col)));
    let encoders = false;
    for (let e = 0; e < keyboard.encoderCount && !encoders; e++) {
      encoders = isUsed(keyboard.getEncoder(layer, e, 0)) || isUsed(keyboard.getEncoder(layer, e, 1));
    }
    if (keys || encoders) usedLayers.add(layer);
  }
  const label = (code: number) => table.label(code).text.replace(/\n/g, " ").trim() || table.serialize(code);
  const tapDances = keyboard.extension(tapDanceExtension)?.entries.map((e) => {
    const parts = (
      [
        ["Tap", e.onTap],
        ["Hold", e.onHold],
        ["Double tap", e.onDoubleTap],
        ["Tap + hold", e.onTapHold],
      ] as const
    ).filter(([, code]) => code !== 0);
    return parts.length === 0 ? null : parts.map(([what, code]) => `${what} ${label(code)}`).join(" · ");
  });
  return { layerNames: keyboard.extension(layerNamesExtension)?.names, usedLayers, tapDances };
}
