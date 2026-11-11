// SPDX-License-Identifier: GPL-2.0-or-later
// Alt repeat key entries, ported from vial-gui src/main/python/protocol/alt_repeat_key.py
// (AltRepeatKeyOptions, AltRepeatKeyEntry, ProtocolAltRepeatKey) and
// protocol/base_protocol.py (_retrieve_dynamic_entries), checked against
// vial-qmk quantum/vial.c (dynamic_vial_alt_repeat_key_get/_set) and
// quantum/vial.h (vial_alt_repeat_key_entry_t).
//
// Wire format: the entry is vial_alt_repeat_key_entry_t, struct format "<HHBB"
// (6 bytes, little-endian): keycode, alt_keycode, allowed_mods, options.
// - get: "BBBB" FE 0D 07 <idx> → reply byte 0 = status (0 = ok), "<HHBB" at [1, 7).
// - set: "BBBB" FE 0D 08 <idx> + "<HHBB" → reply byte 0 = status.
//
// Deviations: entries hold keycodes as integers rather than QMK id strings
// (vial-gui compares entries by their packed bytes anyway, so equality is the
// same), and the set reply's status byte is decoded (vial-gui ignores it).

import { bytes, le16, u16le } from "../util/bytes.ts";
import * as C from "./constants.ts";

/** vial.h vial_arep_option_* bits, as AltRepeatKeyOptions reads them. */
export const AREP_OPTION_DEFAULT_TO_THIS_ALT_KEY = 1 << 0;
export const AREP_OPTION_BIDIRECTIONAL = 1 << 1;
export const AREP_OPTION_IGNORE_MOD_HANDEDNESS = 1 << 2;
export const AREP_ENABLED = 1 << 3;
/** AltRepeatKeyOptions keeps only these four bits; anything else is dropped on load. */
export const AREP_OPTIONS_MASK = 0x0f;

/** Size of vial_alt_repeat_key_entry_t ("<HHBB"). */
export const ALT_REPEAT_KEY_ENTRY_SIZE = 6;

export interface AltRepeatKeyEntry {
  /** Last key: the keycode that was just typed. */
  keycode: number;
  /** The keycode the alt repeat key sends after it. */
  altKeycode: number;
  /** Mod bit field, bit 0 LCtrl … bit 7 RGui. */
  allowedMods: number;
  /** AREP_* bits, masked to AREP_OPTIONS_MASK. */
  options: number;
}

export const EMPTY_ALT_REPEAT_KEY_ENTRY: Readonly<AltRepeatKeyEntry> = {
  keycode: 0,
  altKeycode: 0,
  allowedMods: 0,
  options: 0,
};

/**
 * Brings an entry into the form vial-gui would hold: options through
 * AltRepeatKeyOptions (bits 0-3 only), other fields to their struct widths.
 */
export function normalizeAltRepeatKeyEntry(e: AltRepeatKeyEntry): AltRepeatKeyEntry {
  return {
    keycode: e.keycode & 0xffff,
    altKeycode: e.altKeycode & 0xffff,
    allowedMods: e.allowedMods & 0xff,
    options: e.options & AREP_OPTIONS_MASK,
  };
}

/** AltRepeatKeyEntry.__eq__: equal when the packed structs are equal. */
export function altRepeatKeyEntriesEqual(a: AltRepeatKeyEntry, b: AltRepeatKeyEntry): boolean {
  const x = normalizeAltRepeatKeyEntry(a);
  const y = normalizeAltRepeatKeyEntry(b);
  return (
    x.keycode === y.keycode &&
    x.altKeycode === y.altKeycode &&
    x.allowedMods === y.allowedMods &&
    x.options === y.options
  );
}

/** AltRepeatKeyEntry.serialize(): struct.pack("<HHBB", keycode, alt_keycode, allowed_mods, options). */
export function packAltRepeatKeyEntry(e: AltRepeatKeyEntry): Uint8Array {
  const n = normalizeAltRepeatKeyEntry(e);
  return bytes(le16(n.keycode), le16(n.altKeycode), n.allowedMods, n.options);
}

/** struct.unpack("<HHBB", data[offset:offset + 6]), options through AltRepeatKeyOptions. */
export function unpackAltRepeatKeyEntry(data: Uint8Array, offset = 0): AltRepeatKeyEntry {
  return {
    keycode: u16le(data, offset),
    altKeycode: u16le(data, offset + 2),
    allowedMods: data[offset + 4],
    options: data[offset + 5] & AREP_OPTIONS_MASK,
  };
}

export interface AltRepeatKeyGetReply {
  ok: boolean;
  status: number;
  entry: AltRepeatKeyEntry;
}

/** _retrieve_dynamic_entries(DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, ..., "<HHBB"): "BBBB" idx → status, "<HHBB". */
export const vialAltRepeatKeyGet = {
  encode: (idx: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, idx),
  decode: (r: Uint8Array): AltRepeatKeyGetReply => ({
    ok: r[0] === 0,
    status: r[0],
    entry: unpackAltRepeatKeyEntry(r, 1),
  }),
};

/** alt_repeat_key_set: "BBBB" idx + "<HHBB" → status (0 = ok). */
export const vialAltRepeatKeySet = {
  encode: (idx: number, entry: AltRepeatKeyEntry) =>
    bytes(
      C.CMD_VIA_VIAL_PREFIX,
      C.CMD_VIAL_DYNAMIC_ENTRY_OP,
      C.DYNAMIC_VIAL_ALT_REPEAT_KEY_SET,
      idx,
      packAltRepeatKeyEntry(entry),
    ),
  decode: (r: Uint8Array): { ok: boolean; status: number } => ({ ok: r[0] === 0, status: r[0] }),
};
