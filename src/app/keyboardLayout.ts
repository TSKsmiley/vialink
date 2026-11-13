// SPDX-License-Identifier: GPL-2.0-or-later
// The keyboard layout the user types with (vial-gui: View > Keyboard layout),
// remembered in localStorage by name as vial-gui keeps it in its settings.
// Only key cap labels change; see core/keycodes/keymaps.ts.

import { useSyncExternalStore } from "react";
import type { Keyboard } from "../core/keyboard.ts";
import { findKeyboardLayout, type KeyboardLayout } from "../core/keycodes/keymaps.ts";

const STORAGE_KEY = "vialink.keyboardLayout";
const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: KeyboardLayout = findKeyboardLayout(typeof window === "undefined" ? null : stored());

export function setKeyboardLayout(name: string): void {
  current = findKeyboardLayout(name);
  try {
    if (current.name === "QWERTY") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, current.name);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

export function useKeyboardLayout(): KeyboardLayout {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/**
 * Applies the chosen layout to a keyboard's keycode labels. Call it high in the tree (App):
 * a change re-renders everything below, which then reads the new labels.
 */
export function useKeyboardLayoutLabels(keyboard: Keyboard | null): KeyboardLayout {
  const layout = useKeyboardLayout();
  // Idempotent, and must happen before children render, so it runs during render.
  keyboard?.keycodes.setLabelOverrides(layout.labels);
  return layout;
}
