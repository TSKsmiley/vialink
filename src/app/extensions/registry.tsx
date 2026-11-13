// SPDX-License-Identifier: GPL-2.0-or-later
// UI contributions of the built-in extensions. Each entry matches a core
// extension (src/core/extensions/) by id and only renders when that extension
// is active on the connected board.

import type { ComponentType } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { BrowserStorage } from "../../core/extensions/state.ts";
import type { DeviceContext, KeyboardExtension } from "../../core/extensions/types.ts";
import {
  resolveShortcuts,
  type Decorations,
  type KeyMark,
  type LayerCommand,
  type LayerMark,
} from "./commands.ts";
import type { PanelKit } from "./kit.tsx";
import type { Keyboard } from "../../core/keyboard.ts";
import { layerNamesUi } from "./layerNamesUi.tsx";
import { layerSharingUi } from "./layerSharingUi.tsx";
import { macrosUi } from "./macrosUi.tsx";
import { tapDanceUi } from "./tap-danceUi.tsx";
import { combosUi } from "./combosUi.tsx";
import { keyOverridesUi } from "./key-overridesUi.tsx";
import { altRepeatKeyUi } from "./alt-repeat-keyUi.tsx";
import { qmkSettingsUi } from "./qmk-settingsUi.tsx";

/**
 * What an extension's view gets: its own context (ctx: board, keymap, history,
 * notify, state, device by group), its own state (what its probe returned) and
 * ViaLink's components bound to this keyboard (ui). Panels never touch the
 * Keyboard (plan doc, Extension API, "User interface"; user, 13 Nov).
 */
export interface PanelProps<State = unknown> {
  ctx: DeviceContext;
  state: State;
  ui: PanelKit;
  /** Opens another view of the editor by id ("keymap", "qmk-settings", …). */
  onOpen?: (view: string) => void;
}

/** A whole editor view, shown as a tab next to Keymap and Matrix tester. */
export interface ExtensionPanel<State = unknown> {
  /** Unique within the app, e.g. "macros". */
  id: string;
  title: string;
  Component: ComponentType<PanelProps<State>>;
  /** True when the view uses only the new styles, so the pre-redesign styles stay off it. */
  modern?: boolean;
  /** How many entries are set up, shown next to the title in the sidebar; null shows nothing. */
  count?(state: State): number | null;
}

/** Types a panel for its extension's state, for AppExtension.panels. */
export function panel<State>(p: ExtensionPanel<State>): ExtensionPanel {
  return p as unknown as ExtensionPanel;
}

export interface AppExtension {
  /** Id of the core extension this UI belongs to. */
  id: string;
  /** Editor views this extension adds. */
  panels?: readonly ExtensionPanel[];
  /** Entries for the layer card's ⋯ menu, with optional shortcuts (commands.ts). */
  layerCommands?: readonly LayerCommand[];
  /** Marks on keycaps and layer cards; they get the extension's state. */
  decorations?: Decorations;
}

/** Types decorations for an extension's state, for AppExtension.decorations. */
export function decorations<State>(d: Decorations<State>): Decorations {
  return d as Decorations;
}

export const APP_EXTENSIONS: readonly AppExtension[] = [
  layerSharingUi,
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

/** The views of the extensions running on `keyboard`, each with its extension. */
export function activePanels(keyboard: Keyboard) {
  const running = new Map(keyboard.activeExtensions.map((a) => [a.extension.id, a]));
  return activeUi(keyboard).flatMap((ui) =>
    (ui.panels ?? []).map((panel) => ({ panel, owner: running.get(ui.id)! })),
  );
}

/** The layer commands of the extensions running on `keyboard`, with the shortcut each keeps. */
export function layerCommandsOf(keyboard: Keyboard): { command: LayerCommand; shortcut: string | null }[] {
  const owners = activeUi(keyboard).map((ui) => ({
    extension: keyboard.activeExtensions.find((a) => a.extension.id === ui.id)!.extension,
    commands: ui.layerCommands ?? [],
  }));
  const { shortcuts } = resolveShortcuts(owners);
  return owners.flatMap((o) =>
    o.commands.map((command) => ({ command, shortcut: shortcuts.get(command) ?? null })),
  );
}

/** Shortcut conflicts among the switched-on extensions, for the Extensions dialog. */
export function shortcutConflicts(extensions: readonly KeyboardExtension<unknown>[]) {
  const owners = extensions.flatMap((extension) => {
    const ui = APP_EXTENSIONS.find((u) => u.id === extension.id);
    return ui?.layerCommands ? [{ extension, commands: ui.layerCommands }] : [];
  });
  return resolveShortcuts(owners).conflicts;
}

/** The running extensions' decorations, combined: keycap marks merge, layer card marks list. */
export function decorationsOf(keyboard: Keyboard) {
  const running = activeUi(keyboard).flatMap((ui) => {
    const owner = keyboard.activeExtensions.find((a) => a.extension.id === ui.id);
    return ui.decorations && owner ? [{ d: ui.decorations, state: owner.state }] : [];
  });
  return {
    keycap(layer: number, row: number, col: number): KeyMark | null {
      const code = keyboard.getKey(layer, row, col) ?? 0;
      const marks = running.flatMap(({ d, state }) => d.keycap?.({ layer, row, col, code }, state) ?? []);
      if (marks.length === 0) return null;
      const titles = marks.flatMap((m) => (m.title ? [m.title] : []));
      return { dot: marks.some((m) => m.dot), title: titles.length > 0 ? titles.join("; ") : undefined };
    },
    layerCard(layer: number): LayerMark[] {
      return running.flatMap(({ d, state }) => d.layerCard?.(layer, state) ?? []);
    },
  };
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
