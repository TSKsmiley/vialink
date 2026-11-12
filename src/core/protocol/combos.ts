// SPDX-License-Identifier: GPL-2.0-or-later
// Combo commands, following vial-gui's protocol/combo.py and
// protocol/base_protocol.py (_retrieve_dynamic_entries), and vial-qmk's
// quantum/vial.c (dynamic_vial_combo_get/set) and quantum/vial.h
// (vial_combo_entry_t: uint16_t input[4]; uint16_t output; 10 bytes).
//
// - get: "BBBB" FE 0D 03 <idx> → reply status byte (0 = ok; the firmware
//   returns -1, i.e. 0xFF, for an index past VIAL_COMBO_ENTRIES), then the
//   entry as "<HHHHH" at bytes 1..10.
// - set: "BBBB" FE 0D 04 <idx> + "<HHHHH" entry → reply status byte.
// Keycodes inside the entry are little-endian (the firmware memcpy()s the
// struct), unlike the big-endian VIA keymap commands.

import { bytes, le16, u16le } from "../util/bytes.ts";
import * as C from "./constants.ts";

/** Trigger keys per combo (vial_combo_entry_t.input). */
export const COMBO_INPUTS = 4;
/** sizeof(vial_combo_entry_t), struct.calcsize("<HHHHH"). */
export const COMBO_ENTRY_SIZE = 10;

/** One combo as vial-gui keeps it: four trigger keycodes, then the output keycode. */
export type ComboEntry = [number, number, number, number, number];

export const EMPTY_COMBO: Readonly<ComboEntry> = [0, 0, 0, 0, 0];

export interface ComboGetReply {
  ok: boolean;
  status: number;
  entry: ComboEntry;
}

export interface ComboSetReply {
  ok: boolean;
  status: number;
}

/** struct.pack("<HHHHH", *entry). */
export function packComboEntry(entry: Readonly<ComboEntry>): Uint8Array {
  return bytes(...entry.map((code) => le16(code & 0xffff)));
}

/** struct.unpack("<HHHHH", data[offset:offset + 10]). */
export function unpackComboEntry(data: Uint8Array, offset = 0): ComboEntry {
  return [0, 1, 2, 3, 4].map((i) => u16le(data, offset + i * 2)) as ComboEntry;
}

/** "BBBB" prefix, entry-op, DYNAMIC_VIAL_COMBO_GET, idx → reply status, "<HHHHH". */
export const vialComboGet = {
  encode: (idx: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_COMBO_GET, idx),
  decode: (r: Uint8Array): ComboGetReply => ({
    ok: r[0] === 0,
    status: r[0],
    entry: unpackComboEntry(r, 1),
  }),
};

/** "BBBB" prefix, entry-op, DYNAMIC_VIAL_COMBO_SET, idx + "<HHHHH" entry → reply status. */
export const vialComboSet = {
  encode: (idx: number, entry: Readonly<ComboEntry>) =>
    bytes(
      C.CMD_VIA_VIAL_PREFIX,
      C.CMD_VIAL_DYNAMIC_ENTRY_OP,
      C.DYNAMIC_VIAL_COMBO_SET,
      idx,
      packComboEntry(entry),
    ),
  decode: (r: Uint8Array): ComboSetReply => ({ ok: r[0] === 0, status: r[0] }),
};
