// SPDX-License-Identifier: GPL-2.0-or-later
// The standard Vial command set: the VIA and Vial commands vial-gui sends
// (protocol/constants.py), which every standard Vial firmware answers. A
// "standard" extension may send only these; a "nonstandard" one may also send
// the custom commands its manifest declares (core/extensions/types.ts).
// ViaLink-only; vial-gui has no extension groups.

import * as C from "./constants.ts";

const VIA = new Set([
  C.CMD_VIA_GET_PROTOCOL_VERSION,
  C.CMD_VIA_GET_KEYBOARD_VALUE,
  C.CMD_VIA_SET_KEYBOARD_VALUE,
  C.CMD_VIA_GET_KEYCODE,
  C.CMD_VIA_SET_KEYCODE,
  C.CMD_VIA_LIGHTING_SET_VALUE,
  C.CMD_VIA_LIGHTING_GET_VALUE,
  C.CMD_VIA_LIGHTING_SAVE,
  C.CMD_VIA_MACRO_GET_COUNT,
  C.CMD_VIA_MACRO_GET_BUFFER_SIZE,
  C.CMD_VIA_MACRO_GET_BUFFER,
  C.CMD_VIA_MACRO_SET_BUFFER,
  C.CMD_VIA_GET_LAYER_COUNT,
  C.CMD_VIA_KEYMAP_GET_BUFFER,
]);

const VIAL = new Set([
  C.CMD_VIAL_GET_KEYBOARD_ID,
  C.CMD_VIAL_GET_SIZE,
  C.CMD_VIAL_GET_DEFINITION,
  C.CMD_VIAL_GET_ENCODER,
  C.CMD_VIAL_SET_ENCODER,
  C.CMD_VIAL_GET_UNLOCK_STATUS,
  C.CMD_VIAL_UNLOCK_START,
  C.CMD_VIAL_UNLOCK_POLL,
  C.CMD_VIAL_LOCK,
  C.CMD_VIAL_QMK_SETTINGS_QUERY,
  C.CMD_VIAL_QMK_SETTINGS_GET,
  C.CMD_VIAL_QMK_SETTINGS_SET,
  C.CMD_VIAL_QMK_SETTINGS_RESET,
  C.CMD_VIAL_DYNAMIC_ENTRY_OP,
]);

// Dynamic entries of stock Vial; layer names (0x09, 0x0a) are the Theis194 fork's.
const DYNAMIC = new Set([
  C.DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES,
  C.DYNAMIC_VIAL_TAP_DANCE_GET,
  C.DYNAMIC_VIAL_TAP_DANCE_SET,
  C.DYNAMIC_VIAL_COMBO_GET,
  C.DYNAMIC_VIAL_COMBO_SET,
  C.DYNAMIC_VIAL_KEY_OVERRIDE_GET,
  C.DYNAMIC_VIAL_KEY_OVERRIDE_SET,
  C.DYNAMIC_VIAL_ALT_REPEAT_KEY_GET,
  C.DYNAMIC_VIAL_ALT_REPEAT_KEY_SET,
]);

/** True when `request` is a standard Vial command. */
export function isStandardCommand(request: Uint8Array): boolean {
  const [via, vial, dynamic] = request;
  if (via !== C.CMD_VIA_VIAL_PREFIX) return VIA.has(via);
  if (!VIAL.has(vial)) return false;
  return vial !== C.CMD_VIAL_DYNAMIC_ENTRY_OP || DYNAMIC.has(dynamic);
}

/** True when `request` starts with `bytes`. */
export function startsWith(request: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.length > 0 && bytes.every((b, i) => request[i] === b);
}
