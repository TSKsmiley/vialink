// SPDX-License-Identifier: GPL-2.0-or-later
// QMK settings for the SimulatedKeyboard, answering the way vial-qmk's
// quantum/vial.c and quantum/qmk_settings.c do:
// - query (FE 09 <qsid_gt LE16>): all FF, then the supported qsids greater
//   than qsid_gt, little-endian, as many as fit;
// - get (FE 0A <qsid LE16>): msg[0] = 0 and the value at msg[1..], or
//   msg[0] = 0xFF (-1) for an unknown qsid; the rest of the report is untouched;
// - set (FE 0B <qsid LE16> <value>): value read from msg[4..], msg[0] = status;
// - reset (FE 0C): back to the defaults, report untouched.
// Value widths come from qmk_settings.json, matching the firmware's fields.
// The query answer here replaces SimulatedKeyboardOptions.qmkSettings, so the
// supported list and the stored values cannot disagree.

import { decodeQsidValue, encodeQsidValue } from "../protocol/qmk-settings.ts";
import * as C from "../protocol/constants.ts";
import { u16le } from "../util/bytes.ts";
import { isQsidSupported, qsidWidth } from "../extensions/qmk-settings.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

/**
 * Defaults of a vial-qmk build without mouse keys (qmk_settings_reset with
 * QMK's stock TAPPING_TERM, COMBO_TERM, ONESHOT_* and AUTO_SHIFT_TIMEOUT).
 */
export const SIM_QMK_SETTINGS_DEFAULTS: Readonly<Record<number, number>> = {
  1: 0, // grave_esc_override
  2: 50, // combo_term
  3: 0, // auto_shift
  4: 175, // auto_shift_timeout
  5: 5, // osk_tap_toggle
  6: 5000, // osk_timeout
  7: 200, // tapping_term
  18: 0, // tap_code_delay
  19: 80, // tap_hold_caps_delay
  20: 5, // tapping_toggle
  21: 0, // magic
  22: 0, // permissive hold
  23: 0, // hold on other key press
  24: 0, // retro tapping
  25: 200, // quick_tap_term
  26: 0, // chordal hold
  27: 0, // flow_tap_term
};

export interface SimQmkSettings {
  /** Current values by qsid; the keys are the qsids the board supports. */
  readonly values: Map<number, number>;
  /** What a reset restores. */
  readonly defaults: ReadonlyMap<number, number>;
}

function widthOf(qsid: number): number {
  return isQsidSupported(qsid) ? qsidWidth(qsid) : 1;
}

/**
 * Teaches a simulated keyboard the QMK settings commands. `initial` lists the
 * supported qsids and their current values (default: a stock build's
 * defaults); `defaults` is what a reset goes back to (default: `initial`).
 */
export function installQmkSettings(
  sim: SimulatedKeyboard,
  initial: Readonly<Record<number, number>> = SIM_QMK_SETTINGS_DEFAULTS,
  defaults: Readonly<Record<number, number>> = initial,
): SimQmkSettings {
  const toMap = (r: Readonly<Record<number, number>>) =>
    new Map(Object.entries(r).map(([k, v]) => [Number(k), v] as [number, number]));
  const state: SimQmkSettings = { values: toMap(initial), defaults: toMap(defaults) };

  sim.handlers.push((msg, board) => {
    if (msg[0] !== C.CMD_VIA_VIAL_PREFIX || board.vialProtocol < C.VIAL_PROTOCOL_QMK_SETTINGS) return false;
    switch (msg[1]) {
      case C.CMD_VIAL_QMK_SETTINGS_QUERY: {
        const gt = u16le(msg, 2);
        const ids = [...state.values.keys()].filter((q) => q > gt).sort((a, b) => a - b);
        msg.fill(0xff);
        for (let i = 0; i < ids.length && i * 2 + 2 <= msg.length; i++) {
          msg.set([ids[i] & 0xff, ids[i] >> 8], i * 2);
        }
        return true;
      }
      case C.CMD_VIAL_QMK_SETTINGS_GET: {
        const qsid = u16le(msg, 2);
        const value = state.values.get(qsid);
        if (value === undefined) {
          msg[0] = 0xff;
          return true;
        }
        msg[0] = 0;
        msg.set(encodeQsidValue(value, widthOf(qsid)), 1);
        return true;
      }
      case C.CMD_VIAL_QMK_SETTINGS_SET: {
        const qsid = u16le(msg, 2);
        if (!state.values.has(qsid)) {
          msg[0] = 0xff;
          return true;
        }
        state.values.set(qsid, decodeQsidValue(msg.slice(4), widthOf(qsid)));
        msg[0] = 0;
        return true;
      }
      case C.CMD_VIAL_QMK_SETTINGS_RESET:
        for (const qsid of state.values.keys()) {
          state.values.set(qsid, state.defaults.get(qsid) ?? 0);
        }
        return true;
      default:
        return false;
    }
  });
  return state;
}
