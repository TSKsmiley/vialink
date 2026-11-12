// SPDX-License-Identifier: GPL-2.0-or-later
// Light and dark mode: follows the system setting unless the user picked one.
// Kumo reads `data-mode="dark"` on <html>; index.html runs the same logic
// before first paint so the page never flashes the wrong colours.

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "vialink.theme";
const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = typeof window === "undefined" ? "system" : stored();

function systemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function apply(): void {
  if (typeof document === "undefined") return;
  const dark = choice === "dark" || (choice === "system" && systemDark());
  if (dark) document.documentElement.setAttribute("data-mode", "dark");
  else document.documentElement.removeAttribute("data-mode");
}

if (typeof window !== "undefined") {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    apply();
    listeners.forEach((l) => l());
  });
  apply();
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  apply();
  listeners.forEach((l) => l());
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
    () => "system",
  );
}
