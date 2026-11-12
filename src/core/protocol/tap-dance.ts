// SPDX-License-Identifier: GPL-2.0-or-later
// Tap dance commands, following vial-gui's protocol/tap_dance.py and
// protocol/base_protocol.py (_retrieve_dynamic_entries), and vial-qmk's
// quantum/vial.c (dynamic_vial_tap_dance_get/set) and quantum/vial.h
// (vial_tap_dance_entry_t, 10 bytes).
//
// Entry struct: "<HHHHH" = on_tap, on_hold, on_double_tap, on_tap_hold,
// custom_tapping_term, each a little-endian u16.
// - get: "BBBB" FE 0D 01 <idx> → reply status (0 = ok) then the 10-byte entry.
// - set: "BBBB" FE 0D 02 <idx> + "<HHHHH" → reply status (0 = ok).
// vial-gui ignores the set status; ViaLink decodes it so callers can check it.

import type { Command } from "./commands.ts";
import * as C from "./constants.ts";
import { bytes, le16, u16le } from "../util/bytes.ts";

export interface TapDanceEntry {
  onTap: number;
  onHold: number;
  onDoubleTap: number;
  onTapHold: number;
  /** Milliseconds; the firmware's custom_tapping_term. */
  tappingTerm: number;
}

/** struct.calcsize("<HHHHH"). */
export const TAP_DANCE_ENTRY_SIZE = 10;

/** The four keycode fields, in struct order. */
export const TAP_DANCE_KEY_FIELDS = ["onTap", "onHold", "onDoubleTap", "onTapHold"] as const;
export type TapDanceKeyField = (typeof TAP_DANCE_KEY_FIELDS)[number];

/** struct.pack("<HHHHH", on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term). */
export function packTapDanceEntry(entry: TapDanceEntry): Uint8Array {
  return bytes(
    le16(entry.onTap),
    le16(entry.onHold),
    le16(entry.onDoubleTap),
    le16(entry.onTapHold),
    le16(entry.tappingTerm),
  );
}

/** struct.unpack("<HHHHH", data[offset:offset + 10]). */
export function unpackTapDanceEntry(data: Uint8Array, offset = 0): TapDanceEntry {
  return {
    onTap: u16le(data, offset),
    onHold: u16le(data, offset + 2),
    onDoubleTap: u16le(data, offset + 4),
    onTapHold: u16le(data, offset + 6),
    tappingTerm: u16le(data, offset + 8),
  };
}

export function tapDanceEntriesEqual(a: TapDanceEntry, b: TapDanceEntry): boolean {
  return (
    a.onTap === b.onTap &&
    a.onHold === b.onHold &&
    a.onDoubleTap === b.onDoubleTap &&
    a.onTapHold === b.onTapHold &&
    a.tappingTerm === b.tappingTerm
  );
}

export interface TapDanceGetReply {
  ok: boolean;
  status: number;
  entry: TapDanceEntry;
}

/** "BBBB" idx → reply: status byte, then "<HHHHH" at data[1:11]. */
export const vialTapDanceGet: Command<[number], TapDanceGetReply> = {
  encode: (idx: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_TAP_DANCE_GET, idx),
  decode: (r) => ({ ok: r[0] === 0, status: r[0], entry: unpackTapDanceEntry(r, 1) }),
};

/** "BBBB" idx + "<HHHHH" entry → reply: status byte (0 = ok, 0xFF = no such entry). */
export const vialTapDanceSet: Command<[number, TapDanceEntry], { ok: boolean; status: number }> = {
  encode: (idx: number, entry: TapDanceEntry) =>
    bytes(
      C.CMD_VIA_VIAL_PREFIX,
      C.CMD_VIAL_DYNAMIC_ENTRY_OP,
      C.DYNAMIC_VIAL_TAP_DANCE_SET,
      idx,
      packTapDanceEntry(entry),
    ),
  decode: (r) => ({ ok: r[0] === 0, status: r[0] }),
};
