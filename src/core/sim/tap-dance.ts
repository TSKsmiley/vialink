// SPDX-License-Identifier: GPL-2.0-or-later
// Tap dance for the simulated keyboard, answering as vial-qmk's quantum/vial.c
// (dynamic_vial_tap_dance_get/set, vial_keycode_firewall) and
// quantum/nvm/eeprom/nvm_dynamic_keymap.c (status -1 for an index out of
// range) do. Entries start as the firmware's reset value: KC_NO x4 and
// TAPPING_TERM (200 ms).

import {
  CMD_VIA_VIAL_PREFIX,
  CMD_VIAL_DYNAMIC_ENTRY_OP,
  DYNAMIC_VIAL_TAP_DANCE_GET,
  DYNAMIC_VIAL_TAP_DANCE_SET,
  VIAL_PROTOCOL_DYNAMIC,
} from "../protocol/constants.ts";
import {
  TAP_DANCE_ENTRY_SIZE,
  packTapDanceEntry,
  unpackTapDanceEntry,
  type TapDanceEntry,
} from "../protocol/tap-dance.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

export interface SimTapDanceOptions {
  /** Must match the simulator's dynamic.tapDance count. */
  count: number;
  /** Initial entries; missing ones get the firmware default. */
  entries?: Partial<TapDanceEntry>[];
}

export interface SimTapDance {
  /** The board's stored entries; tests may read or edit them. */
  readonly entries: TapDanceEntry[];
}

export const DEFAULT_TAPPING_TERM = 200;

/** QK_BOOT in the firmware's keycode numbering (vial protocol 6 renumbered QMK keycodes). */
function qkBoot(vialProtocol: number): number {
  return vialProtocol >= 6 ? 0x7c00 : 0x5c00;
}

/** Teaches `sim` the tap dance get/set commands. */
export function installTapDanceSimulator(sim: SimulatedKeyboard, opts: SimTapDanceOptions): SimTapDance {
  const entries: TapDanceEntry[] = [];
  for (let i = 0; i < opts.count; i++) {
    entries.push({
      onTap: 0,
      onHold: 0,
      onDoubleTap: 0,
      onTapHold: 0,
      tappingTerm: DEFAULT_TAPPING_TERM,
      ...opts.entries?.[i],
    });
  }

  sim.handlers.push((msg, board) => {
    if (msg[0] !== CMD_VIA_VIAL_PREFIX || msg[1] !== CMD_VIAL_DYNAMIC_ENTRY_OP) return false;
    if (board.vialProtocol < VIAL_PROTOCOL_DYNAMIC) return false;
    const idx = msg[3];
    if (msg[2] === DYNAMIC_VIAL_TAP_DANCE_GET) {
      const entry = entries[idx];
      msg[0] = entry ? 0 : 0xff;
      msg.set(entry ? packTapDanceEntry(entry) : new Uint8Array(TAP_DANCE_ENTRY_SIZE), 1);
      return true;
    }
    if (msg[2] === DYNAMIC_VIAL_TAP_DANCE_SET) {
      const td = unpackTapDanceEntry(msg, 4);
      const boot = qkBoot(board.vialProtocol);
      const firewall = (code: number) => (code === boot && !board.unlocked ? 0 : code);
      td.onTap = firewall(td.onTap);
      td.onHold = firewall(td.onHold);
      td.onDoubleTap = firewall(td.onDoubleTap);
      td.onTapHold = firewall(td.onTapHold);
      if (idx < entries.length) {
        entries[idx] = td;
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
