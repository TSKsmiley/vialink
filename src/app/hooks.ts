// SPDX-License-Identifier: GPL-2.0-or-later
import { useSyncExternalStore } from "react";
import { keycodeDescriptions, layerNames, type KeycodeDescription } from "../core/extensions/services.ts";
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
  // Tap dance summaries come from whoever describes TD(n) keycodes (the tap dance extension).
  const describe = keycodeDescriber(keyboard);
  const tapDances: (string | null)[] = [];
  for (let n = 0; n < 256; n++) {
    const d = describe(table.parse(`TD(${n})`));
    if (!d) break;
    tapDances.push(d.text);
  }
  const names = keyboard.provided(layerNames);
  const layerNamesList =
    names.length === 0
      ? undefined
      : Array.from({ length: keyboard.layers }, (_, l) => names.map((p) => p.name(l)).find((n) => n) ?? "");
  return { layerNames: layerNamesList, usedLayers, tapDances: tapDances.length > 0 ? tapDances : undefined };
}

/** Describes a keycode through the extensions that own it (core keycode descriptions service). */
export function keycodeDescriber(keyboard: Keyboard): (code: number) => KeycodeDescription | null {
  const providers = keyboard.provided(keycodeDescriptions);
  return (code) => {
    for (const p of providers) {
      const d = p.describe(code);
      if (d) return d;
    }
    return null;
  };
}
