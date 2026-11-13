// SPDX-License-Identifier: GPL-2.0-or-later
// UI contributions of the built-in extensions. Each entry matches a core
// extension (src/core/extensions/) by id and only renders when that extension
// is active on the connected board.

import type { ComponentType } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { BrowserStorage } from "../../core/extensions/state.ts";
import type { KeyboardExtension } from "../../core/extensions/types.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { layerNamesUi } from "./layerNamesUi.tsx";
import { macrosUi } from "./macrosUi.tsx";
import { tapDanceUi } from "./tap-danceUi.tsx";
import { combosUi } from "./combosUi.tsx";
import { keyOverridesUi } from "./key-overridesUi.tsx";
import { altRepeatKeyUi } from "./alt-repeat-keyUi.tsx";
import { qmkSettingsUi } from "./qmk-settingsUi.tsx";

export interface PanelProps {
  keyboard: Keyboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Opens another view of the editor by id ("keymap", "qmk-settings", …); absent outside the editor. */
  onOpen?: (view: string) => void;
}

/** A whole editor view, shown as a tab next to Keymap and Matrix tester. */
export interface ExtensionPanel {
  /** Unique within the app, e.g. "macros". */
  id: string;
  title: string;
  Component: ComponentType<PanelProps>;
  /** True when the view uses only the new styles, so the pre-redesign styles stay off it. */
  modern?: boolean;
  /** How many entries are set up, shown next to the title in the sidebar; null shows nothing. */
  count?(keyboard: Keyboard): number | null;
}

export interface AppExtension {
  /** Id of the core extension this UI belongs to. */
  id: string;
  /** Text for a layer tab, replacing the bare layer number; null keeps the default. */
  layerTabLabel?(keyboard: Keyboard, layer: number): string | null;
  /** Editor views this extension adds. */
  panels?: readonly ExtensionPanel[];
}

export const APP_EXTENSIONS: readonly AppExtension[] = [
  layerNamesUi,
  macrosUi,
  tapDanceUi,
  combosUi,
  keyOverridesUi,
  altRepeatKeyUi,
  qmkSettingsUi,
];

/** UI entries whose core extension is active on this keyboard. */
export function activeUi(keyboard: Keyboard): AppExtension[] {
  const active = new Set(keyboard.activeExtensions.map((a) => a.extension.id));
  return APP_EXTENSIONS.filter((ui) => active.has(ui.id));
}

// ── Enabled/disabled setting (per browser) ──────────────────────────────────

// Old project name (vial-ts), kept so existing settings carry over.
const STORAGE_KEY = "vial-ts.disabledExtensions";

export function loadDisabledExtensions(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveDisabledExtensions(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked (private window etc.): the setting lasts for this page only.
  }
}

export function enabledExtensions(disabled: Set<string>): KeyboardExtension<unknown>[] {
  return BUILTIN_EXTENSIONS.filter((ext) => !disabled.has(ext.id));
}

// ── When each extension was last turned on by hand (per browser) ────────────
// Settles conflicts on connect: of two conflicting extensions a keyboard
// supports, the one turned on more recently runs (0: never turned on by hand).

const TURNED_ON_KEY = "vialink.extensionsTurnedOn";

function loadTurnedOn(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(TURNED_ON_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
}

let turnedOn: Record<string, number> | null = null;

/** When `id` was last turned on by hand; higher is more recent, 0 when never. */
export function extensionRecency(id: string): number {
  turnedOn ??= loadTurnedOn();
  return turnedOn[id] ?? 0;
}

/** Records that the user turned these extensions on now. */
export function markTurnedOn(ids: readonly string[]): void {
  turnedOn ??= loadTurnedOn();
  // Strictly increasing, so two turn-ons in the same millisecond still have an order.
  let now = Math.max(Date.now(), ...Object.values(turnedOn).map((t) => t + 1));
  for (const id of ids) turnedOn[id] = now++;
  try {
    localStorage.setItem(TURNED_ON_KEY, JSON.stringify(turnedOn));
  } catch {
    // Storage blocked: remembered for this page only.
  }
}

// ── Extensions' "browser" state (ctx.state with persist: "browser") ─────────

/** localStorage for extensions' browser state; blocked storage leaves values for this page only. */
export const extensionBrowserStorage: BrowserStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    localStorage.setItem(key, value); // ctx.state catches a failure
  },
};
