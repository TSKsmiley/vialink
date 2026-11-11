// SPDX-License-Identifier: GPL-2.0-or-later
// Every VIA/Vial command used so far, as a pure pair of functions over bytes.
// Byte layouts follow vial-gui's protocol/keyboard_comm.py, dynamic.py and
// macro.py (struct formats noted per command). VIA fields are big-endian, Vial
// fields little-endian, and some replies echo the command while others don't.

import { be16, be32, bytes, le16, le32, u16be, u16le, u32be, u32le, u64le } from "../util/bytes.ts";
import * as C from "./constants.ts";

export interface Command<Args extends unknown[], Result> {
  encode(...args: Args): Uint8Array;
  decode(reply: Uint8Array): Result;
}

function cmd<Args extends unknown[], Result>(c: Command<Args, Result>): Command<Args, Result> {
  return c;
}

const ignore = (): void => undefined;

// ── VIA ────────────────────────────────────────────────────────────────────

/** "B" → reply ">BH": echo, protocol version. */
export const viaGetProtocolVersion = cmd({
  encode: () => bytes(C.CMD_VIA_GET_PROTOCOL_VERSION),
  decode: (r) => u16be(r, 1),
});

/** "B" → reply "BB": echo, layer count. */
export const viaGetLayerCount = cmd({
  encode: () => bytes(C.CMD_VIA_GET_LAYER_COUNT),
  decode: (r) => r[1],
});

/** ">BBBB" layer,row,col → reply ">BBBBH": echo, keycode. */
export const viaGetKeycode = cmd({
  encode: (layer: number, row: number, col: number) => bytes(C.CMD_VIA_GET_KEYCODE, layer, row, col),
  decode: (r) => u16be(r, 4),
});

/** ">BBBBH" layer,row,col,keycode → echo. */
export const viaSetKeycode = cmd({
  encode: (layer: number, row: number, col: number, keycode: number) =>
    bytes(C.CMD_VIA_SET_KEYCODE, layer, row, col, be16(keycode)),
  decode: ignore,
});

/** ">BHB" offset,size → reply echoes the header, data at [4, 4+size). */
export const viaKeymapGetBuffer = cmd({
  encode: (offset: number, size: number) => bytes(C.CMD_VIA_KEYMAP_GET_BUFFER, be16(offset), size),
  decode: (r: Uint8Array) => r.slice(4, 4 + r[3]),
});

/** "BB" VIA_LAYOUT_OPTIONS → reply ">BBI": echo, id, packed options. */
export const viaGetLayoutOptions = cmd({
  encode: () => bytes(C.CMD_VIA_GET_KEYBOARD_VALUE, C.VIA_LAYOUT_OPTIONS),
  decode: (r) => u32be(r, 2),
});

/** ">BBI" VIA_LAYOUT_OPTIONS, packed options → echo. */
export const viaSetLayoutOptions = cmd({
  encode: (options: number) => bytes(C.CMD_VIA_SET_KEYBOARD_VALUE, C.VIA_LAYOUT_OPTIONS, be32(options)),
  decode: ignore,
});

/** "B" → reply "BB": echo, number of macros. */
export const viaMacroGetCount = cmd({
  encode: () => bytes(C.CMD_VIA_MACRO_GET_COUNT),
  decode: (r) => r[1],
});

/** "B" → reply ">BH": echo, macro buffer size in bytes. */
export const viaMacroGetBufferSize = cmd({
  encode: () => bytes(C.CMD_VIA_MACRO_GET_BUFFER_SIZE),
  decode: (r) => u16be(r, 1),
});

// ── Vial (prefix 0xFE; replies do not echo the command) ─────────────────────

export interface KeyboardId {
  vialProtocol: number;
  uid: bigint;
}

/** "BB" → reply "<IQ": Vial protocol version, keyboard UID. */
export const vialGetKeyboardId = cmd({
  encode: () => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_GET_KEYBOARD_ID),
  decode: (r): KeyboardId => ({ vialProtocol: u32le(r, 0), uid: u64le(r, 4) }),
});

/** "BB" → reply "<I": compressed definition size in bytes. */
export const vialGetDefinitionSize = cmd({
  encode: () => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_GET_SIZE),
  decode: (r) => u32le(r, 0),
});

/** "<BBI" page → reply is 32 raw bytes of the compressed definition. */
export const vialGetDefinitionPage = cmd({
  encode: (page: number) => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_GET_DEFINITION, le32(page)),
  decode: (r: Uint8Array) => r.slice(0, 32),
});

/** "BBBB" layer,index → reply ">HH": keycode for direction 0 (CCW), direction 1 (CW). */
export const vialGetEncoder = cmd({
  encode: (layer: number, index: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_GET_ENCODER, layer, index),
  decode: (r): [number, number] => [u16be(r, 0), u16be(r, 2)],
});

/** ">BBBBBH" layer,index,direction,keycode. */
export const vialSetEncoder = cmd({
  encode: (layer: number, index: number, direction: 0 | 1, keycode: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_SET_ENCODER, layer, index, direction, be16(keycode)),
  decode: ignore,
});

export interface UnlockStatus {
  unlocked: boolean;
  inProgress: boolean;
  /** Matrix positions the user must hold to unlock. */
  keys: { row: number; col: number }[];
}

/** "BB" → reply: unlocked, in-progress, then up to 15 (row, col) pairs, 255 = unused. */
export const vialGetUnlockStatus = cmd({
  encode: () => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_GET_UNLOCK_STATUS),
  decode: (r): UnlockStatus => {
    const keys: { row: number; col: number }[] = [];
    for (let x = 0; x < 15; x++) {
      const row = r[2 + x * 2];
      const col = r[3 + x * 2];
      if (row !== 255 && col !== 255) keys.push({ row, col });
    }
    return { unlocked: r[0] === 1, inProgress: r[1] === 1, keys };
  },
});

export interface DynamicEntryCounts {
  tapDance: number;
  combo: number;
  keyOverride: number;
  altRepeatKey: number;
  /** Raw feature bit field from the last byte of the reply. */
  featureFlags: number;
}

/** "BBB" → reply: tap dance, combo, key override, alt-repeat counts; data[-1] feature bits. */
export const vialGetDynamicEntryCounts = cmd({
  encode: () =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES),
  decode: (r): DynamicEntryCounts => ({
    tapDance: r[0],
    combo: r[1],
    keyOverride: r[2],
    altRepeatKey: r[3],
    featureFlags: r[r.length - 1],
  }),
});

/**
 * "<BBH" first qsid → reply: little-endian u16 qsids greater than `first`,
 * padded with 0xFFFF once the list is exhausted.
 */
export const vialQmkSettingsQuery = cmd({
  encode: (first: number) => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_QMK_SETTINGS_QUERY, le16(first)),
  decode: (r: Uint8Array): number[] => {
    const out: number[] = [];
    for (let x = 0; x + 1 < r.length; x += 2) out.push(u16le(r, x));
    return out;
  },
});

export interface LayerNameReply {
  ok: boolean;
  status: number;
  name: string;
}

/**
 * Theis194 layer-names extension: "BBBB" layer → reply status (0 = ok),
 * then 16 bytes of NUL-padded UTF-8.
 */
export const vialGetLayerName = cmd({
  encode: (layer: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_DYNAMIC_ENTRY_OP, C.DYNAMIC_VIAL_LAYER_NAME_GET, layer),
  decode: (r): LayerNameReply => {
    const raw = r.slice(1, 1 + C.LAYER_NAME_LEN);
    const end = raw.indexOf(0);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(end === -1 ? raw : raw.slice(0, end));
    return { ok: r[0] === 0, status: r[0], name };
  },
});
