// SPDX-License-Identifier: GPL-2.0-or-later
// Typed access to keycodes.json, which scripts/dump_keycodes.py extracts from
// vial-gui's keycodes/keycodes*.py. Never edit the JSON by hand; re-run the dump.

import raw from "./data/keycodes.json";

export interface KeycodeDef {
  qmk_id: string;
  label: string;
  tooltip?: string;
  /** Takes an inner keycode, e.g. "LSFT(kc)". */
  masked?: boolean;
  printable?: string;
  alias?: string[];
  requires_feature?: string;
}

export interface VersionTable {
  /** QMK constant name → integer value. */
  kc: Record<string, number>;
  /** Values of every "...(kc)" constant (the high byte of a masked keycode). */
  masked: number[];
}

export type StaticListName =
  | "KEYCODES_SPECIAL"
  | "KEYCODES_BASIC"
  | "KEYCODES_BASIC_NUMPAD"
  | "KEYCODES_BASIC_NAV"
  | "KEYCODES_SHIFTED"
  | "KEYCODES_ISO"
  | "KEYCODES_ISO_KR"
  | "KEYCODES_BOOT"
  | "KEYCODES_MODIFIERS"
  | "KEYCODES_QUANTUM"
  | "KEYCODES_BACKLIGHT"
  | "KEYCODES_MEDIA"
  | "KEYCODES_MACRO_BASE"
  | "KEYCODES_MIDI_BASIC"
  | "KEYCODES_MIDI_ADVANCED";

interface KeycodeData {
  source: { repo: string; commit: string; files: string[] };
  v5: VersionTable;
  v6: VersionTable;
  lists: Record<StaticListName, KeycodeDef[]>;
}

const data = raw as unknown as KeycodeData;

export const KEYCODE_SOURCE = data.source;
export const VERSION_TABLES = { 5: data.v5, 6: data.v6 } as const;

/**
 * The static lists, with the module-level `.extend()` calls of keycodes.py
 * applied: KEYCODES_BASIC also holds the numpad and nav keys, and
 * KEYCODES_ISO also holds the Korean keys.
 */
export const LISTS: Record<StaticListName, KeycodeDef[]> = {
  ...data.lists,
  KEYCODES_BASIC: [
    ...data.lists.KEYCODES_BASIC,
    ...data.lists.KEYCODES_BASIC_NUMPAD,
    ...data.lists.KEYCODES_BASIC_NAV,
  ],
  KEYCODES_ISO: [...data.lists.KEYCODES_ISO, ...data.lists.KEYCODES_ISO_KR],
};
