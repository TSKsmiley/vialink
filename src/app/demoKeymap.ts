// SPDX-License-Identifier: GPL-2.0-or-later
// The demo keyboard's starter keymap: a KLOR (Polydactyl layout) with QWERTY
// on Base, numbers and symbols on Lower, F-keys and navigation on Raise, and
// lighting on Adjust (Lower's and Raise's thumb keys held together). Written as
// QMK names so it reads like a keymap; demoKeymap() turns them into keycodes.
//
// The KLOR's matrix: rows 0-3 are the left half, rows 4-7 the right half. In
// each half column 0 is the outer pinky column (two keys, rows 1-2 and 5-6),
// columns 1-5 run from the pinky to the inner index finger, and row 3 / row 7
// holds the four thumb keys (columns 1-4, outer to inner) and, in column 5,
// the key under the encoder. "" is a key the layout doesn't draw (KC_NO),
// "_" is transparent.

import { KeycodeTable } from "../core/keycodes/table.ts";

type Layer = readonly (readonly string[])[];

const BASE: Layer = [
  ["", "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T"],
  ["TD(0)", "KC_A", "KC_S", "KC_D", "KC_F", "KC_G"],
  ["KC_LSFT", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B"],
  ["", "KC_LGUI", "KC_LCTL", "KC_TAB", "LT(1, KC_SPC)", "KC_MUTE"],
  ["", "KC_P", "KC_O", "KC_I", "KC_U", "KC_Y"],
  ["KC_QUOT", "KC_SCLN", "KC_L", "KC_K", "KC_J", "KC_H"],
  ["KC_RSFT", "KC_SLSH", "KC_DOT", "KC_COMM", "KC_M", "KC_N"],
  ["", "KC_DEL", "KC_LALT", "KC_BSPC", "LT(2, KC_ENT)", "KC_MPLY"],
];

const LOWER: Layer = [
  ["", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5"],
  ["_", "KC_EXLM", "KC_AT", "KC_HASH", "KC_DLR", "KC_PERC"],
  ["_", "KC_GRV", "KC_MINS", "KC_EQL", "KC_LBRC", "KC_RBRC"],
  ["", "_", "_", "_", "_", "_"],
  ["", "KC_0", "KC_9", "KC_8", "KC_7", "KC_6"],
  ["_", "KC_RPRN", "KC_LPRN", "KC_ASTR", "KC_AMPR", "KC_CIRC"],
  ["_", "KC_BSLS", "KC_PIPE", "KC_PLUS", "KC_UNDS", "KC_TILD"],
  ["", "_", "_", "_", "MO(3)", "_"],
];

const RAISE: Layer = [
  ["", "KC_F1", "KC_F2", "KC_F3", "KC_F4", "KC_F5"],
  ["_", "KC_F6", "KC_F7", "KC_F8", "KC_F9", "KC_F10"],
  ["_", "KC_F11", "KC_F12", "KC_PSCR", "KC_INS", "KC_CAPS"],
  ["", "_", "_", "_", "MO(3)", "_"],
  ["", "_", "KC_END", "KC_PGUP", "KC_PGDN", "KC_HOME"],
  ["_", "_", "KC_RGHT", "KC_UP", "KC_DOWN", "KC_LEFT"],
  ["_", "_", "KC_MNXT", "KC_VOLU", "KC_VOLD", "KC_MPRV"],
  ["", "_", "_", "_", "_", "_"],
];

const ADJUST: Layer = [
  ["", "RGB_TOG", "RGB_MOD", "RGB_HUI", "RGB_SAI", "RGB_VAI"],
  ["_", "RGB_RMOD", "RGB_HUD", "RGB_SAD", "RGB_VAD", "RGB_SPI"],
  ["_", "_", "_", "_", "_", "RGB_SPD"],
  ["", "_", "_", "_", "_", "_"],
  ["", "QK_BOOT", "_", "_", "_", "_"],
  ["_", "_", "_", "_", "_", "_"],
  ["_", "_", "_", "_", "_", "_"],
  ["", "_", "_", "_", "_", "_"],
];

/** Encoders per layer, [counter-clockwise, clockwise]: volume on the left, tracks on the right. */
const ENCODERS: readonly (readonly [string, string])[][] = [
  [
    ["KC_VOLD", "KC_VOLU"],
    ["KC_MPRV", "KC_MNXT"],
  ],
  [
    ["_", "_"],
    ["_", "_"],
  ],
  [
    ["_", "_"],
    ["_", "_"],
  ],
  [
    ["RGB_VAD", "RGB_VAI"],
    ["RGB_RMOD", "RGB_MOD"],
  ],
];

export interface DemoKeymap {
  /** [layer][row][col] */
  keymap: number[][][];
  /** [layer][encoder] = [ccw, cw] */
  encoders: [number, number][][];
}

export function demoKeymap(): DemoKeymap {
  const table = new KeycodeTable({ vialProtocol: 6, layers: 4, macroCount: 16, tapDanceCount: 4 });
  const code = (name: string) => (name === "" ? 0x00 : name === "_" ? 0x01 : table.parse(name));
  return {
    keymap: [BASE, LOWER, RAISE, ADJUST].map((layer) => layer.map((row) => row.map(code))),
    encoders: ENCODERS.map((layer) => layer.map(([ccw, cw]) => [code(ccw), code(cw)] as [number, number])),
  };
}
