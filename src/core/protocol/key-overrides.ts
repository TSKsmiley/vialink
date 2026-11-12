// SPDX-License-Identifier: GPL-2.0-or-later
// Key override commands, ported from vial-gui src/main/python/protocol/key_override.py
// (KeyOverrideEntry, KeyOverrideOptions, ProtocolKeyOverride) and checked
// against vial-qmk quantum/vial.c (dynamic_vial_key_override_get/set) and
// quantum/vial.h (vial_key_override_entry_t, the vial_ko_* option bits).
//
// Wire entry: struct vial_key_override_entry_t, 10 bytes, little-endian,
// Python struct format "<HHHBBBB":
//   trigger u16, replacement u16, layers u16,
//   trigger_mods u8, negative_mod_mask u8, suppressed_mods u8, options u8.
// - get: "BBBB" FE 0D 05 <idx> → reply byte 0 = status (0 = ok), entry at [1, 11).
// - set: "BBBB" FE 0D 06 <idx> + entry → reply byte 0 = status.
// vial-gui ignores the set reply; vial-ts checks its status byte (see extension).

import type { Command } from "./commands.ts";
import * as C from "./constants.ts";
import { bytes, le16, u16le } from "../util/bytes.ts";

/** One key override, as vial_key_override_entry_t. Keycodes are integers. */
export interface KeyOverrideEntry {
  trigger: number;
  replacement: number;
  /** Bit n = active on layer n (16 layers). */
  layers: number;
  /** Mod bits: 0 LCtrl, 1 LShift, 2 LAlt, 3 LGui, 4 RCtrl, 5 RShift, 6 RAlt, 7 RGui. */
  triggerMods: number;
  negativeModMask: number;
  suppressedMods: number;
  /** KO_OPTION_* and KO_ENABLED bits. */
  options: number;
}

/** sizeof(vial_key_override_entry_t), _Static_assert'ed in vial.h. */
export const KEY_OVERRIDE_ENTRY_SIZE = 10;

// vial.h vial_ko_* / key_override.py KeyOverrideOptions.
export const KO_OPTION_ACTIVATION_TRIGGER_DOWN = 1 << 0;
export const KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN = 1 << 1;
export const KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP = 1 << 2;
export const KO_OPTION_ONE_MOD = 1 << 3;
export const KO_OPTION_NO_REREGISTER_TRIGGER = 1 << 4;
export const KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN = 1 << 5;
export const KO_ENABLED = 1 << 7;
/** Bits KeyOverrideOptions keeps: bit 6 is unused and dropped on every parse. */
export const KO_OPTIONS_MASK = 0xbf;

/** struct.pack("<HHHBBBB", ...) of KeyOverrideEntry.serialize(). */
export function packKeyOverride(e: KeyOverrideEntry): Uint8Array {
  return bytes(
    le16(e.trigger),
    le16(e.replacement),
    le16(e.layers),
    e.triggerMods,
    e.negativeModMask,
    e.suppressedMods,
    e.options,
  );
}

/** struct.unpack("<HHHBBBB", data[offset:offset + 10]). */
export function unpackKeyOverride(data: Uint8Array, offset = 0): KeyOverrideEntry {
  return {
    trigger: u16le(data, offset),
    replacement: u16le(data, offset + 2),
    layers: u16le(data, offset + 4),
    triggerMods: data[offset + 6],
    negativeModMask: data[offset + 7],
    suppressedMods: data[offset + 8],
    options: data[offset + 9],
  };
}

export interface KeyOverrideGetReply {
  ok: boolean;
  status: number;
  entry: KeyOverrideEntry;
}

/** "BBBB" idx → reply status, then "<HHHBBBB" at data[1:11] (base_protocol._retrieve_dynamic_entries). */
export const vialKeyOverrideGet: Command<[index: number], KeyOverrideGetReply> = {
  encode: (index) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_KEY_OVERRIDE_GET, index),
  decode: (r) => ({ ok: r[0] === 0, status: r[0], entry: unpackKeyOverride(r, 1) }),
};

/** "BBBB" idx + "<HHHBBBB" entry (key_override_set) → reply status. */
export const vialKeyOverrideSet: Command<
  [index: number, entry: KeyOverrideEntry],
  { ok: boolean; status: number }
> = {
  encode: (index, entry) =>
    bytes(
      C.CMD_VIA_VIAL_PREFIX,
      C.CMD_VIAL_DYNAMIC_ENTRY_OP,
      C.DYNAMIC_VIAL_KEY_OVERRIDE_SET,
      index,
      packKeyOverride(entry),
    ),
  decode: (r) => ({ ok: r[0] === 0, status: r[0] }),
};
