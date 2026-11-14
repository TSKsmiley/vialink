// SPDX-License-Identifier: GPL-2.0-or-later
// Lighting commands, following vial-gui's protocol/keyboard_comm.py
// (reload_persistent_rgb, reload_rgb, set_qmk_*, _vialrgb_set_mode, save_rgb)
// and protocol/constants.py, and the firmware side in vial-qmk's quantum/via.c
// (via_qmk_backlight_*_value, via_qmk_rgblight_*_value) and quantum/vialrgb.c.
//
// QMK backlight / rgblight ("lighting": "qmk_backlight", "qmk_rgblight" or
// "qmk_backlight_rgblight" in vial.json):
// - get: 08 <value id> → the value at reply[2] (colour: hue, sat at reply[2..3]);
// - set: 07 <value id> <value…> → no reply data.
// VialRGB ("lighting": "vialrgb"), little-endian:
// - info:      08 40          → reply[2..3] protocol version, reply[4] maximum brightness;
// - mode:      08 41          → reply[2..3] effect id, [4] speed, [5..7] hue, sat, val;
// - supported: 08 42 <gt LE16> → effect ids > gt at reply[2..], LE16 each, 0xFFFF = none;
// - set mode:  07 41 <mode LE16> speed h s v ("BBHBBBB", native order on x86 = LE).
// Save: 09 → the firmware writes the current lighting to EEPROM.
//
// A firmware built without any lighting answers 07/08/09 with id_unhandled
// (0xFF in reply[0]); vialrgb_get_value leaves a report it doesn't know
// untouched.

import { bytes, le16, u16le } from "../util/bytes.ts";
import * as C from "./constants.ts";
import type { Command } from "./commands.ts";

/** via.c's id_unhandled: the command id byte of a reply the firmware did not handle. */
export const ID_UNHANDLED = 0xff;

export const QMK_BACKLIGHT_BRIGHTNESS = 0x09;
export const QMK_BACKLIGHT_EFFECT = 0x0a;
export const QMK_RGBLIGHT_BRIGHTNESS = 0x80;
export const QMK_RGBLIGHT_EFFECT = 0x81;
export const QMK_RGBLIGHT_EFFECT_SPEED = 0x82;
export const QMK_RGBLIGHT_COLOR = 0x83;
export const VIALRGB_GET_INFO = 0x40;
export const VIALRGB_GET_MODE = 0x41;
export const VIALRGB_GET_SUPPORTED = 0x42;
export const VIALRGB_SET_MODE = 0x41;

/** The only VialRGB protocol version vial-gui accepts (reload_persistent_rgb). */
export const VIALRGB_PROTOCOL_VERSION = 1;

/** One-byte QMK lighting values (backlight and rgblight). */
export type QmkLightingValue =
  | typeof QMK_BACKLIGHT_BRIGHTNESS
  | typeof QMK_BACKLIGHT_EFFECT
  | typeof QMK_RGBLIGHT_BRIGHTNESS
  | typeof QMK_RGBLIGHT_EFFECT
  | typeof QMK_RGBLIGHT_EFFECT_SPEED;

const unhandled = (r: Uint8Array) => r[0] === ID_UNHANDLED;

/** ">BB" 08 id → reply[2], or null when the firmware has no lighting. */
export const qmkLightingGet: Command<[id: QmkLightingValue], number | null> = {
  encode: (id) => bytes(C.CMD_VIA_LIGHTING_GET_VALUE, id),
  decode: (r) => (unhandled(r) ? null : r[2]),
};

/** ">BBB" 07 id value. */
export const qmkLightingSet: Command<[id: QmkLightingValue, value: number], void> = {
  encode: (id, value) => bytes(C.CMD_VIA_LIGHTING_SET_VALUE, id, byte(value)),
  decode: () => undefined,
};

/** ">BB" 08 83 → hue, sat at reply[2..3]. */
export const qmkRgblightGetColor: Command<[], { hue: number; sat: number } | null> = {
  encode: () => bytes(C.CMD_VIA_LIGHTING_GET_VALUE, QMK_RGBLIGHT_COLOR),
  decode: (r) => (unhandled(r) ? null : { hue: r[2], sat: r[3] }),
};

/** ">BBBB" 07 83 hue sat. */
export const qmkRgblightSetColor: Command<[hue: number, sat: number], void> = {
  encode: (hue, sat) => bytes(C.CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_COLOR, byte(hue), byte(sat)),
  decode: () => undefined,
};

export interface VialRgbInfo {
  version: number;
  maxBrightness: number;
}

/** "BB" 08 40 → version LE16, maximum brightness; null when unhandled. */
export const vialRgbGetInfo: Command<[], VialRgbInfo | null> = {
  encode: () => bytes(C.CMD_VIA_LIGHTING_GET_VALUE, VIALRGB_GET_INFO),
  decode: (r) => (unhandled(r) ? null : { version: u16le(r, 2), maxBrightness: r[4] }),
};

export interface VialRgbMode {
  /** VialRGB effect id (0 = off). */
  mode: number;
  speed: number;
  hue: number;
  sat: number;
  val: number;
}

/** "BB" 08 41 → mode LE16, speed, hue, sat, val. */
export const vialRgbGetMode: Command<[], VialRgbMode> = {
  encode: () => bytes(C.CMD_VIA_LIGHTING_GET_VALUE, VIALRGB_GET_MODE),
  decode: (r) => ({ mode: u16le(r, 2), speed: r[4], hue: r[5], sat: r[6], val: r[7] }),
};

/** "<BBH" 08 42 gt → the supported effect ids above gt; 0xFFFF entries are dropped. */
export const vialRgbGetSupported: Command<[greaterThan: number], number[]> = {
  encode: (gt) => bytes(C.CMD_VIA_LIGHTING_GET_VALUE, VIALRGB_GET_SUPPORTED, le16(gt)),
  decode: (r) => {
    const ids: number[] = [];
    for (let i = 2; i + 1 < r.length; i += 2) {
      const id = u16le(r, i);
      if (id !== 0xffff) ids.push(id);
    }
    return ids;
  },
};

/** "BBHBBBB" 07 41 mode speed hue sat val. */
export const vialRgbSetMode: Command<[mode: VialRgbMode], void> = {
  encode: ({ mode, speed, hue, sat, val }) =>
    bytes(
      C.CMD_VIA_LIGHTING_SET_VALUE,
      VIALRGB_SET_MODE,
      le16(mode),
      byte(speed),
      byte(hue),
      byte(sat),
      byte(val),
    ),
  decode: () => undefined,
};

/** ">B" 09: store the current lighting in EEPROM. */
export const lightingSave: Command<[], void> = {
  encode: () => bytes(C.CMD_VIA_LIGHTING_SAVE),
  decode: () => undefined,
};

function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`${value} is not a byte`);
  return value;
}
