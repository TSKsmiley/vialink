// SPDX-License-Identifier: GPL-2.0-or-later
// Commands and decorations: UI an extension gives as data, which ViaLink
// draws (plan doc, Extension API, "User interface"). ViaLink-only.
//
// - Commands: entries for the layer card's ⋯ menu (and right-click), with an
//   optional keyboard shortcut. A shortcut already taken (by ViaLink or an
//   extension earlier in load order) is refused: the command stays in its
//   menu without one, and the Extensions dialog names both extensions.
// - Decorations: small marks on keycaps and layer cards.

import type { KeyboardExtension } from "../../core/extensions/types.ts";

/** What the keymap view offers layer commands (layer sharing's built-in commands use its actions). */
export interface LayerCommandEnv {
  layerCount: number;
  layerName(layer: number): string;
  /** Copies a layer (or the selected keys) for pasting. */
  copy(layer: number): void;
  /** Opens the paste preview onto a layer; absent when nothing is copied. */
  paste?(layer: number): void;
  duplicate(layer: number): void;
  /** Whether an empty layer exists to duplicate into. */
  canDuplicate: boolean;
  swap(layer: number, other: number): void;
  clear(layer: number): void;
  copyAsText(layer: number): void;
  pasteFromText(): void;
}

export interface LayerCommand {
  /** Unique within the extension. */
  id: string;
  title: string | ((layer: number) => string);
  /** E.g. "Ctrl+Shift+C"; Ctrl means Cmd on a Mac. */
  shortcut?: string;
  /** The keymap view handles this shortcut itself (Ctrl+C also copies selected keys); it is only shown. */
  shortcutHandledByView?: boolean;
  /** Commands of one section stay together; a line separates sections. */
  section?: string;
  danger?: boolean;
  enabled?(layer: number, env: LayerCommandEnv): boolean;
  /** A submenu: run() gets the chosen value. */
  choices?(layer: number, env: LayerCommandEnv): { label: string; value: number }[];
  run(layer: number, env: LayerCommandEnv, choice?: number): void;
}

/** A mark on a keycap (e.g. a dot on keys that have a note). */
export interface KeyMark {
  dot?: boolean;
  /** Added to the key's tooltip and accessible name. */
  title?: string;
}

/** A mark on a layer card, shown under its details. */
export interface LayerMark {
  text: string;
  title?: string;
}

export interface Decorations<State = unknown> {
  keycap?(key: { layer: number; row: number; col: number; code: number }, state: State): KeyMark | null;
  layerCard?(layer: number, state: State): LayerMark | null;
}

/** Shortcuts ViaLink itself uses everywhere (undo and redo). */
export const RESERVED_SHORTCUTS: ReadonlyMap<string, string> = new Map([
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z", "Redo"],
  ["Ctrl+Y", "Redo"],
]);

/** "ctrl+shift+c" and "Shift+Ctrl+C" both become "Ctrl+Shift+C". */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const mods = ["ctrl", "alt", "shift"].filter(
    (m) => parts.includes(m) || (m === "ctrl" && parts.includes("cmd")),
  );
  return [
    ...mods.map((m) => m[0].toUpperCase() + m.slice(1)),
    key.length === 1 ? key.toUpperCase() : key,
  ].join("+");
}

/** The shortcut a key press means, in {@link normalizeShortcut} form. */
export function shortcutOf(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  const mods = [
    e.ctrlKey || e.metaKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  return normalizeShortcut([...mods, e.key].join("+"));
}

export interface ShortcutConflict {
  shortcut: string;
  /** The extension (or "ViaLink") that keeps it. */
  keptBy: string;
  /** The extension whose command loses it. */
  refused: string;
  command: string;
}

/**
 * Which commands keep their shortcut: ViaLink's own first, then extensions in
 * load order. Returns the shortcut per command (null when refused) and every
 * conflict, for the Extensions dialog.
 */
export function resolveShortcuts(
  owners: readonly { extension: Pick<KeyboardExtension, "id" | "name">; commands: readonly LayerCommand[] }[],
): { shortcuts: Map<LayerCommand, string | null>; conflicts: ShortcutConflict[] } {
  const taken = new Map<string, string>([...RESERVED_SHORTCUTS.keys()].map((s) => [s, "ViaLink"]));
  const shortcuts = new Map<LayerCommand, string | null>();
  const conflicts: ShortcutConflict[] = [];
  for (const { extension, commands } of owners) {
    for (const command of commands) {
      if (!command.shortcut) continue;
      const shortcut = normalizeShortcut(command.shortcut);
      const holder = taken.get(shortcut);
      if (holder && holder !== extension.name) {
        shortcuts.set(command, null);
        conflicts.push({
          shortcut,
          keptBy: holder,
          refused: extension.name,
          command: typeof command.title === "string" ? command.title : command.id,
        });
        continue;
      }
      taken.set(shortcut, extension.name);
      shortcuts.set(command, shortcut);
    }
  }
  return { shortcuts, conflicts };
}
