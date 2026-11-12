// SPDX-License-Identifier: GPL-2.0-or-later
// Combo storage for the SimulatedKeyboard, answering like vial-qmk's
// quantum/vial.c (dynamic_vial_combo_get/set) on top of
// quantum/nvm/eeprom/nvm_dynamic_keymap.c (nvm_dynamic_keymap_get/set_combo):
// - an index past the combo count answers status -1 (0xFF);
// - set runs the output through vial_keycode_firewall (QK_BOOT becomes KC_NO
//   while the board is locked); the trigger keys are stored as sent.
// The count reported by GET_NUMBER_OF_ENTRIES comes from the simulator's own
// `dynamic` option; pass the same number here.

import { packComboEntry, unpackComboEntry, type ComboEntry } from "../protocol/combos.ts";
import * as C from "../protocol/constants.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

/** QK_BOOT in the keycode table the board uses (v5: 0x5C00, v6: 0x7C00), as KeycodeTable picks it. */
function bootKeycode(vialProtocol: number): number {
  return vialProtocol === 6 ? 0x7c00 : 0x5c00;
}

export interface SimulatedCombos {
  /** Stored entries, one per combo slot; edit freely in tests. */
  readonly entries: ComboEntry[];
}

export interface InstallCombosOptions {
  /** Number of combo slots (VIAL_COMBO_ENTRIES); match the simulator's dynamic.combo. */
  count: number;
  /** Initial entries; missing ones are all KC_NO. */
  entries?: ComboEntry[];
}

/** Teaches `sim` the combo get/set commands. Returns the live combo storage. */
export function installCombos(sim: SimulatedKeyboard, options: InstallCombosOptions): SimulatedCombos {
  const entries: ComboEntry[] = Array.from(
    { length: options.count },
    (_, i) => [...(options.entries?.[i] ?? [0, 0, 0, 0, 0])] as ComboEntry,
  );
  sim.handlers.push((msg, board) => {
    if (msg[0] !== C.CMD_VIA_VIAL_PREFIX || msg[1] !== C.CMD_VIAL_DYNAMIC_ENTRY_OP) return false;
    if (board.vialProtocol < C.VIAL_PROTOCOL_DYNAMIC) return false;
    const idx = msg[3];
    if (msg[2] === C.DYNAMIC_VIAL_COMBO_GET) {
      // vial.c: entry = { 0 }; msg[0] = status; memcpy(&msg[1], &entry, sizeof(entry)).
      const entry = idx < entries.length ? entries[idx] : ([0, 0, 0, 0, 0] as ComboEntry);
      msg[0] = idx < entries.length ? 0 : 0xff;
      msg.set(packComboEntry(entry), 1);
      return true;
    }
    if (msg[2] === C.DYNAMIC_VIAL_COMBO_SET) {
      const entry = unpackComboEntry(msg, 4);
      if (entry[4] === bootKeycode(board.vialProtocol) && !board.unlocked) entry[4] = 0;
      if (idx < entries.length) {
        entries[idx] = entry;
        msg[0] = 0;
      } else {
        msg[0] = 0xff;
      }
      return true;
    }
    return false;
  });
  return { entries };
}
