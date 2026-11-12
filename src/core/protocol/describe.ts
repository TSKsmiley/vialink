// SPDX-License-Identifier: GPL-2.0-or-later
// Readable names for raw HID requests, for the HID log (design board 6).
// ViaLink-only: vial-gui logs bytes. Covers every command ViaLink sends
// (commands.ts and the extensions' protocol files); anything else is named
// by its bytes.

import * as C from "./constants.ts";

export type CommandKind = "read" | "write" | "unlock" | "poll";

export interface CommandDescription {
  name: string;
  kind: CommandKind;
}

const hex = (n: number, width = 2) => `0x${n.toString(16).padStart(width, "0")}`;
const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);

const DYNAMIC: Record<number, [string, CommandKind]> = {
  [C.DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES]: ["Get number of tap dances, combos, key overrides…", "read"],
  [C.DYNAMIC_VIAL_TAP_DANCE_GET]: ["Get tap dance", "read"],
  [C.DYNAMIC_VIAL_TAP_DANCE_SET]: ["Set tap dance", "write"],
  [C.DYNAMIC_VIAL_COMBO_GET]: ["Get combo", "read"],
  [C.DYNAMIC_VIAL_COMBO_SET]: ["Set combo", "write"],
  [C.DYNAMIC_VIAL_KEY_OVERRIDE_GET]: ["Get key override", "read"],
  [C.DYNAMIC_VIAL_KEY_OVERRIDE_SET]: ["Set key override", "write"],
  [C.DYNAMIC_VIAL_ALT_REPEAT_KEY_GET]: ["Get alt repeat key", "read"],
  [C.DYNAMIC_VIAL_ALT_REPEAT_KEY_SET]: ["Set alt repeat key", "write"],
  [C.DYNAMIC_VIAL_LAYER_NAME_GET]: ["Get layer name", "read"],
  [C.DYNAMIC_VIAL_LAYER_NAME_SET]: ["Set layer name", "write"],
};

/**
 * Names a request. `keycode` turns a keycode into a QMK name for "Set key"
 * (the keyboard's table); without it, keycodes show as hex.
 */
export function describeRequest(req: Uint8Array, keycode?: (code: number) => string): CommandDescription {
  const kc = (code: number) => (keycode ? keycode(code) : hex(code, 4));
  const r = (name: string): CommandDescription => ({ name, kind: "read" });
  const w = (name: string): CommandDescription => ({ name, kind: "write" });
  switch (req[0]) {
    case C.CMD_VIA_GET_PROTOCOL_VERSION:
      return r("Get VIA protocol version");
    case C.CMD_VIA_GET_KEYBOARD_VALUE:
      if (req[1] === C.VIA_LAYOUT_OPTIONS) return r("Get layout options");
      if (req[1] === C.VIA_SWITCH_MATRIX_STATE) return { name: "Read pressed switches", kind: "poll" };
      return r(`Get keyboard value ${hex(req[1] ?? 0)}`);
    case C.CMD_VIA_SET_KEYBOARD_VALUE:
      if (req[1] === C.VIA_LAYOUT_OPTIONS) return w("Set layout options");
      return w(`Set keyboard value ${hex(req[1] ?? 0)}`);
    case C.CMD_VIA_GET_KEYCODE:
      return r(`Get key L${req[1]} R${req[2]} C${req[3]}`);
    case C.CMD_VIA_SET_KEYCODE:
      return w(`Set key L${req[1]} R${req[2]} C${req[3]} → ${kc(u16be(req, 4))}`);
    case C.CMD_VIA_LIGHTING_SET_VALUE:
      return w("Set lighting value");
    case C.CMD_VIA_LIGHTING_GET_VALUE:
      return r("Get lighting value");
    case C.CMD_VIA_LIGHTING_SAVE:
      return w("Save lighting");
    case C.CMD_VIA_MACRO_GET_COUNT:
      return r("Get macro count");
    case C.CMD_VIA_MACRO_GET_BUFFER_SIZE:
      return r("Get macro memory size");
    case C.CMD_VIA_MACRO_GET_BUFFER:
      return r(`Get macro memory at ${u16be(req, 1)}`);
    case C.CMD_VIA_MACRO_SET_BUFFER:
      return w(`Set macro memory at ${u16be(req, 1)} (${req[3] ?? 0} bytes)`);
    case C.CMD_VIA_GET_LAYER_COUNT:
      return r("Get layer count");
    case C.CMD_VIA_KEYMAP_GET_BUFFER:
      return r(`Get keymap at ${u16be(req, 1)}`);
    case C.CMD_VIA_VIAL_PREFIX:
      return describeVial(req, kc);
    default:
      return r(`Unknown command ${hex(req[0] ?? 0)}`);
  }
}

function describeVial(req: Uint8Array, kc: (code: number) => string): CommandDescription {
  const r = (name: string): CommandDescription => ({ name, kind: "read" });
  const w = (name: string): CommandDescription => ({ name, kind: "write" });
  switch (req[1]) {
    case C.CMD_VIAL_GET_KEYBOARD_ID:
      return r("Vial: get keyboard id");
    case C.CMD_VIAL_GET_SIZE:
      return r("Vial: get definition size");
    case C.CMD_VIAL_GET_DEFINITION:
      return r(`Vial: get definition (block ${u16le(req, 2)})`);
    case C.CMD_VIAL_GET_ENCODER:
      return r(`Get encoder L${req[2]} #${req[3]}`);
    case C.CMD_VIAL_SET_ENCODER:
      return w(
        `Set encoder L${req[2]} #${req[3]} ${req[4] === 0 ? "counter-clockwise" : "clockwise"} → ${kc(u16be(req, 5))}`,
      );
    case C.CMD_VIAL_GET_UNLOCK_STATUS:
      return { name: "Get lock status", kind: "unlock" };
    case C.CMD_VIAL_UNLOCK_START:
      return { name: "Start unlock", kind: "unlock" };
    case C.CMD_VIAL_UNLOCK_POLL:
      return { name: "Unlock: check held keys", kind: "poll" };
    case C.CMD_VIAL_LOCK:
      return { name: "Lock", kind: "unlock" };
    case C.CMD_VIAL_QMK_SETTINGS_QUERY:
      return r(`QMK settings: list from ${hex(u16le(req, 2), 4)}`);
    case C.CMD_VIAL_QMK_SETTINGS_GET:
      return r(`Get QMK setting ${hex(u16le(req, 2), 4)}`);
    case C.CMD_VIAL_QMK_SETTINGS_SET:
      return w(`Set QMK setting ${hex(u16le(req, 2), 4)}`);
    case C.CMD_VIAL_QMK_SETTINGS_RESET:
      return w("Reset QMK settings to defaults");
    case C.CMD_VIAL_DYNAMIC_ENTRY_OP: {
      const op = DYNAMIC[req[2] ?? -1];
      if (!op) return r(`Vial: dynamic entry op ${hex(req[2] ?? 0)}`);
      const index = req[2] === C.DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES ? "" : ` ${req[3] ?? 0}`;
      return { name: op[0] + index, kind: op[1] };
    }
    default:
      return r(`Unknown Vial command ${hex(req[1] ?? 0)}`);
  }
}

/** True for replies that report a refused write (Vial's status byte), for the log's error filter. */
export function isRejected(req: Uint8Array, reply: Uint8Array): boolean {
  if (req[0] !== C.CMD_VIA_VIAL_PREFIX) return false;
  const statusFirst = req[1] === C.CMD_VIAL_DYNAMIC_ENTRY_OP || req[1] === C.CMD_VIAL_QMK_SETTINGS_SET;
  return statusFirst && reply[0] !== 0;
}
