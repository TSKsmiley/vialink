// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from vial-gui src/main/python/protocol/constants.py and util.py
// (https://github.com/vial-kb/vial-gui, GPL-2.0-or-later).

export const CMD_VIA_GET_PROTOCOL_VERSION = 0x01;
export const CMD_VIA_GET_KEYBOARD_VALUE = 0x02;
export const CMD_VIA_SET_KEYBOARD_VALUE = 0x03;
export const CMD_VIA_GET_KEYCODE = 0x04;
export const CMD_VIA_SET_KEYCODE = 0x05;
export const CMD_VIA_LIGHTING_SET_VALUE = 0x07;
export const CMD_VIA_LIGHTING_GET_VALUE = 0x08;
export const CMD_VIA_LIGHTING_SAVE = 0x09;
export const CMD_VIA_MACRO_GET_COUNT = 0x0c;
export const CMD_VIA_MACRO_GET_BUFFER_SIZE = 0x0d;
export const CMD_VIA_MACRO_GET_BUFFER = 0x0e;
export const CMD_VIA_MACRO_SET_BUFFER = 0x0f;
export const CMD_VIA_GET_LAYER_COUNT = 0x11;
export const CMD_VIA_KEYMAP_GET_BUFFER = 0x12;
export const CMD_VIA_VIAL_PREFIX = 0xfe;

export const VIA_LAYOUT_OPTIONS = 0x02;
export const VIA_SWITCH_MATRIX_STATE = 0x03;

export const CMD_VIAL_GET_KEYBOARD_ID = 0x00;
export const CMD_VIAL_GET_SIZE = 0x01;
export const CMD_VIAL_GET_DEFINITION = 0x02;
export const CMD_VIAL_GET_ENCODER = 0x03;
export const CMD_VIAL_SET_ENCODER = 0x04;
export const CMD_VIAL_GET_UNLOCK_STATUS = 0x05;
export const CMD_VIAL_UNLOCK_START = 0x06;
export const CMD_VIAL_UNLOCK_POLL = 0x07;
export const CMD_VIAL_LOCK = 0x08;
export const CMD_VIAL_QMK_SETTINGS_QUERY = 0x09;
export const CMD_VIAL_QMK_SETTINGS_GET = 0x0a;
export const CMD_VIAL_QMK_SETTINGS_SET = 0x0b;
export const CMD_VIAL_QMK_SETTINGS_RESET = 0x0c;
export const CMD_VIAL_DYNAMIC_ENTRY_OP = 0x0d;

export const DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES = 0x00;
export const DYNAMIC_VIAL_TAP_DANCE_GET = 0x01;
export const DYNAMIC_VIAL_TAP_DANCE_SET = 0x02;
export const DYNAMIC_VIAL_COMBO_GET = 0x03;
export const DYNAMIC_VIAL_COMBO_SET = 0x04;
export const DYNAMIC_VIAL_KEY_OVERRIDE_GET = 0x05;
export const DYNAMIC_VIAL_KEY_OVERRIDE_SET = 0x06;
export const DYNAMIC_VIAL_ALT_REPEAT_KEY_GET = 0x07;
export const DYNAMIC_VIAL_ALT_REPEAT_KEY_SET = 0x08;
// Theis194/vial-gui dynamic-layer-names branch (protocol/constants.py, layer_name.py).
export const DYNAMIC_VIAL_LAYER_NAME_GET = 0x09;
export const DYNAMIC_VIAL_LAYER_NAME_SET = 0x0a;
export const LAYER_NAME_LEN = 16;

/** How much of a keymap or macro buffer fits in one packet. */
export const BUFFER_FETCH_CHUNK = 28;

export const VIAL_PROTOCOL_ADVANCED_MACROS = 2;
export const VIAL_PROTOCOL_MATRIX_TESTER = 3;
export const VIAL_PROTOCOL_DYNAMIC = 4;
export const VIAL_PROTOCOL_QMK_SETTINGS = 4;
export const VIAL_PROTOCOL_EXT_MACROS = 5;
export const VIAL_PROTOCOL_KEY_OVERRIDE = 5;

/** From protocol/keyboard_comm.py. -1 means "not reported". */
export const SUPPORTED_VIA_PROTOCOL = [-1, 9];
export const SUPPORTED_VIAL_PROTOCOL = [-1, 0, 1, 2, 3, 4, 5, 6];

/** Raw-HID interface shared by VIA and Vial (util.py::is_rawhid). */
export const RAW_HID_USAGE_PAGE = 0xff60;
export const RAW_HID_USAGE = 0x61;

/** Serial-number marker of Vial firmware. WebHID cannot read serial numbers; kept for reference. */
export const VIAL_SERIAL_NUMBER_MAGIC = "vial:f64c2b3c";

/**
 * UIDs of the vial-qmk example keyboards (util.py). A board shipping with one
 * of these was never given its own UID.
 */
export const EXAMPLE_KEYBOARDS: readonly bigint[] = [
  0xd4a36200603e3007n, // vial_stm32f103_vibl
  0x32f62bc2eef2237bn, // vial_atmega32u4
  0x38cea320f23046a5n, // vial_stm32f072
  0xbed2d31ec59a0bd8n, // vial_stm32f401
];
/** Anything whose low 56 bits equal this is also an example UID. */
export const EXAMPLE_KEYBOARD_PREFIX = 0xa6867bdfd3b00fn;

export function isExampleUid(uid: bigint): boolean {
  return EXAMPLE_KEYBOARDS.includes(uid) || (uid & 0xffffffffffffffn) === EXAMPLE_KEYBOARD_PREFIX;
}
