// SPDX-License-Identifier: GPL-2.0-or-later
// Macro buffer support for the SimulatedKeyboard, answering the way vial-qmk
// does: quantum/via.c (id_dynamic_keymap_macro_get_count/_get_buffer_size/
// _get_buffer/_set_buffer, including the VIAL_ENABLE "don't allow changing
// macros until unlocked" skip, which replies with an untouched echo) and
// quantum/nvm/eeprom/nvm_dynamic_keymap.c (reads past the end return 0x00,
// writes past the end are dropped). Requests with size > 28 are ignored, as in
// via.c.

import { be16, u16be } from "../util/bytes.ts";
import * as C from "../protocol/constants.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

export interface SimulatedMacroOptions {
  /** DYNAMIC_KEYMAP_MACRO_COUNT. */
  count: number;
  /** Macro buffer size in bytes (DYNAMIC_KEYMAP_MACRO_EEPROM_SIZE). */
  memory: number;
  /** Initial buffer contents; the rest is zero-filled (a freshly reset EEPROM). */
  contents?: Uint8Array;
}

export interface SimulatedMacros {
  readonly count: number;
  readonly memory: number;
  /** The simulated EEPROM; tests may read or change it directly. */
  readonly buffer: Uint8Array;
  /** Number of set-buffer writes the board accepted. */
  writes: number;
}

/**
 * Teaches `sim` the macro commands. Answers count and size from `opts`
 * (overriding the SimulatedKeyboard's own macroCount/macroBufferSize).
 */
export function installMacroSimulator(sim: SimulatedKeyboard, opts: SimulatedMacroOptions): SimulatedMacros {
  const buffer = new Uint8Array(opts.memory);
  if (opts.contents) buffer.set(opts.contents.subarray(0, opts.memory));
  const state: SimulatedMacros = { count: opts.count, memory: opts.memory, buffer, writes: 0 };

  sim.handlers.push((msg, board) => {
    switch (msg[0]) {
      case C.CMD_VIA_MACRO_GET_COUNT:
        msg[1] = state.count;
        return true;
      case C.CMD_VIA_MACRO_GET_BUFFER_SIZE:
        msg.set(be16(state.memory), 1);
        return true;
      case C.CMD_VIA_MACRO_GET_BUFFER: {
        const offset = u16be(msg, 1);
        const size = msg[3];
        if (size <= 28) {
          for (let i = 0; i < size; i++) msg[4 + i] = offset + i < state.memory ? buffer[offset + i] : 0;
        }
        return true;
      }
      case C.CMD_VIA_MACRO_SET_BUFFER: {
        if (!board.unlocked) return true; // goto skip: echo untouched
        const offset = u16be(msg, 1);
        const size = msg[3];
        if (size <= 28) {
          for (let i = 0; i < size; i++) if (offset + i < state.memory) buffer[offset + i] = msg[4 + i];
          state.writes++;
        }
        return true;
      }
      default:
        return false;
    }
  });
  return state;
}
