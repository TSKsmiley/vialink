// SPDX-License-Identifier: GPL-2.0-or-later
import { useSyncExternalStore } from "react";
import type { Keyboard } from "../core/keyboard.ts";

/** Re-renders whenever the keyboard's state changes; returns its version counter. */
export function useKeyboardVersion(kb: Keyboard): number {
  return useSyncExternalStore(
    (cb) => kb.subscribe(cb),
    () => kb.version,
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
