// SPDX-License-Identifier: GPL-2.0-or-later
// Simulator support for alt repeat keys: answers dynamic_vial_alt_repeat_key_get
// and _set the way vial-qmk's quantum/vial.c does (vial_alt_repeat_key_entry_t,
// "<HHBB"; status 0 = ok, -1 (0xFF) for an index out of range; the keycode
// firewall stores QK_BOOT as KC_NO while the board is locked). The entry count
// itself comes from the SimulatedKeyboard's `dynamic.altRepeatKey` option, which
// must match the `count` given here.

import {
  ALT_REPEAT_KEY_ENTRY_SIZE,
  packAltRepeatKeyEntry,
  type AltRepeatKeyEntry,
} from "../protocol/alt-repeat-key.ts";
import * as C from "../protocol/constants.ts";
import { u16le } from "../util/bytes.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

export interface SimAltRepeatKeyOptions {
  /** VIAL_ALT_REPEAT_KEY_ENTRIES. */
  count: number;
  /** Initial entries; missing ones are all zero. */
  entries?: AltRepeatKeyEntry[];
  /** QK_BOOT for the firmware's keycode version (0x7C00 for Vial protocol 6). */
  bootKeycode?: number;
}

/** The simulated EEPROM: raw entries, exactly as stored (options byte not masked). */
export interface SimAltRepeatKeyState {
  readonly entries: AltRepeatKeyEntry[];
}

export function installAltRepeatKey(
  sim: SimulatedKeyboard,
  opts: SimAltRepeatKeyOptions,
): SimAltRepeatKeyState {
  const boot = opts.bootKeycode ?? 0x7c00;
  const state: SimAltRepeatKeyState = {
    entries: Array.from({ length: opts.count }, (_, i) => ({
      keycode: 0,
      altKeycode: 0,
      allowedMods: 0,
      options: 0,
      ...opts.entries?.[i],
    })),
  };
  const firewall = (code: number) => (code === boot && !sim.unlocked ? 0 : code);

  sim.handlers.push((msg) => {
    if (msg[0] !== C.CMD_VIA_VIAL_PREFIX || msg[1] !== C.CMD_VIAL_DYNAMIC_ENTRY_OP) return false;
    if (sim.vialProtocol < C.VIAL_PROTOCOL_DYNAMIC) return false;
    const idx = msg[3];
    if (msg[2] === C.DYNAMIC_VIAL_ALT_REPEAT_KEY_GET) {
      const entry = state.entries[idx];
      msg.fill(0, 1, 1 + ALT_REPEAT_KEY_ENTRY_SIZE);
      if (!entry) {
        msg[0] = 0xff;
        return true;
      }
      msg[0] = 0;
      msg.set(packRaw(entry), 1);
      return true;
    }
    if (msg[2] === C.DYNAMIC_VIAL_ALT_REPEAT_KEY_SET) {
      if (idx >= state.entries.length) {
        msg[0] = 0xff;
        return true;
      }
      state.entries[idx] = {
        keycode: firewall(u16le(msg, 4)),
        altKeycode: firewall(u16le(msg, 6)),
        allowedMods: msg[8],
        options: msg[9],
      };
      msg[0] = 0;
      return true;
    }
    return false;
  });
  return state;
}

/** Packs without masking options, as the firmware stores whatever byte it got. */
function packRaw(e: AltRepeatKeyEntry): Uint8Array {
  const out = packAltRepeatKeyEntry(e);
  out[5] = e.options & 0xff;
  return out;
}
