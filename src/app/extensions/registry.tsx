// SPDX-License-Identifier: GPL-2.0-or-later
// UI contributions of the built-in extensions. Each entry matches a core
// extension (src/core/extensions/) by id and only renders when that extension
// is active on the connected board.

import type { ComponentType } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { KeyboardExtension } from "../../core/extensions/types.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { layerNamesUi } from "./layerNamesUi.tsx";
import { macrosUi } from "./macrosUi.tsx";
import { tapDanceUi } from "./tap-danceUi.tsx";
import { combosUi } from "./combosUi.tsx";
import { keyOverridesUi } from "./key-overridesUi.tsx";
import { altRepeatKeyUi } from "./alt-repeat-keyUi.tsx";
import { qmkSettingsUi } from "./qmk-settingsUi.tsx";

export interface LayerActionProps {
  keyboard: Keyboard;
  layer: number;
  onError: (message: string) => void;
}

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
  /** Controls shown next to the layer tabs for the selected layer. */
  LayerActions?: ComponentType<LayerActionProps>;
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
