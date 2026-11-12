// SPDX-License-Identifier: GPL-2.0-or-later
// Simulated key override storage for SimulatedKeyboard, answering the way
// vial-qmk quantum/vial.c (dynamic_vial_key_override_get/set) and
// quantum/dynamic_keymap.c (nvm get/set, dynamic_keymap_reset defaults) do:
// - get: msg[0] = status (0 ok, 0xFF = -1 for an index out of range), the
//   10-byte entry copied to msg[1..11), the rest of the report untouched;
// - set: the entry is read from msg[4..14), QK_BOOT in the replacement becomes
//   KC_NO while the board is locked (vial_keycode_firewall), msg[0] = status.
// The entry count reported by "get number of entries" comes from the
// simulator's own `dynamic.keyOverride` option; pass the same count here.

import * as C from "../protocol/constants.ts";
import {
  KEY_OVERRIDE_ENTRY_SIZE,
  KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP,
  KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN,
  KO_OPTION_ACTIVATION_TRIGGER_DOWN,
  packKeyOverride,
  unpackKeyOverride,
  type KeyOverrideEntry,
} from "../protocol/key-overrides.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

/** What dynamic_keymap_reset() writes to every entry. */
export function defaultKeyOverride(): KeyOverrideEntry {
  return {
    trigger: 0,
    replacement: 0,
    layers: 0xffff,
    triggerMods: 0,
    negativeModMask: 0,
    suppressedMods: 0,
    options:
      KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP |
      KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN |
      KO_OPTION_ACTIVATION_TRIGGER_DOWN,
  };
}

export interface SimulatedKeyOverrides {
  readonly count: number;
  /** Raw EEPROM image, count × 10 bytes. */
  readonly storage: Uint8Array;
  get(index: number): KeyOverrideEntry;
  put(index: number, entry: KeyOverrideEntry): void;
}

/** QK_BOOT for the simulator's keycode table (v6 from Vial protocol 6, v5 before). */
function qkBoot(sim: SimulatedKeyboard): number {
  return sim.vialProtocol >= 6 ? 0x7c00 : 0x5c00;
}

/**
 * Adds key override get/set to a simulated board. `entries` fills the first
 * slots; the rest hold dynamic_keymap_reset()'s defaults.
 */
export function installKeyOverrides(
  sim: SimulatedKeyboard,
  options: { count: number; entries?: KeyOverrideEntry[] },
): SimulatedKeyOverrides {
  const { count } = options;
  const storage = new Uint8Array(count * KEY_OVERRIDE_ENTRY_SIZE);
  const store: SimulatedKeyOverrides = {
    count,
    storage,
    get: (index) => unpackKeyOverride(storage, index * KEY_OVERRIDE_ENTRY_SIZE),
    put: (index, entry) => storage.set(packKeyOverride(entry), index * KEY_OVERRIDE_ENTRY_SIZE),
  };
  for (let i = 0; i < count; i++) store.put(i, options.entries?.[i] ?? defaultKeyOverride());

  sim.handlers.push((msg, board) => {
    if (msg[0] !== C.CMD_VIA_VIAL_PREFIX || msg[1] !== C.CMD_VIAL_DYNAMIC_ENTRY_OP) return false;
    if (board.vialProtocol < C.VIAL_PROTOCOL_DYNAMIC) return false;
    const index = msg[3];
    if (msg[2] === C.DYNAMIC_VIAL_KEY_OVERRIDE_GET) {
      const ok = index < count;
      msg[0] = ok ? 0 : 0xff;
      const at = index * KEY_OVERRIDE_ENTRY_SIZE;
      msg.set(
        ok ? storage.subarray(at, at + KEY_OVERRIDE_ENTRY_SIZE) : new Uint8Array(KEY_OVERRIDE_ENTRY_SIZE),
        1,
      );
      return true;
    }
    if (msg[2] === C.DYNAMIC_VIAL_KEY_OVERRIDE_SET) {
      const entry = unpackKeyOverride(msg, 4);
      if (entry.replacement === qkBoot(board) && !board.unlocked) entry.replacement = 0;
      const ok = index < count;
      if (ok) store.put(index, entry);
      msg[0] = ok ? 0 : 0xff;
      return true;
    }
    return false;
  });
  return store;
}
