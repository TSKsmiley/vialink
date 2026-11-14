// SPDX-License-Identifier: GPL-2.0-or-later
// Lighting for the SimulatedKeyboard, answering the way vial-qmk's
// quantum/via.c (via_qmk_backlight_*_value, via_qmk_rgblight_*_value,
// id_lighting_save) and quantum/vialrgb.c (vialrgb_get_value,
// vialrgb_set_value, get_supported) do. A board without any installed kind
// answers id_unhandled (the simulator's default).
// Simplifications: backlight brightness is stored as sent (the firmware rounds
// it to BACKLIGHT_LEVELS steps); VialRGB effect ids are stored as sent.

import * as C from "../protocol/constants.ts";
import {
  QMK_BACKLIGHT_BRIGHTNESS,
  QMK_BACKLIGHT_EFFECT,
  QMK_RGBLIGHT_BRIGHTNESS,
  QMK_RGBLIGHT_COLOR,
  QMK_RGBLIGHT_EFFECT,
  QMK_RGBLIGHT_EFFECT_SPEED,
  VIALRGB_GET_INFO,
  VIALRGB_GET_MODE,
  VIALRGB_GET_SUPPORTED,
  VIALRGB_SET_MODE,
} from "../protocol/lighting.ts";
import { u16le } from "../util/bytes.ts";
import type { SimulatedKeyboard } from "./simulatedKeyboard.ts";

export interface SimLighting {
  backlight?: { brightness: number; breathing: boolean };
  rgblight?: { brightness: number; effect: number; speed: number; hue: number; sat: number };
  vialrgb?: {
    version: number;
    maxBrightness: number;
    /** Supported effect ids other than 0, ascending. */
    effects: number[];
    mode: number;
    speed: number;
    hue: number;
    sat: number;
    val: number;
  };
  /** How many times the board was asked to save to EEPROM. */
  saves: number;
  /** The lighting at the last save (what survives an unplug). */
  saved: string | null;
}

/** A VialRGB board's starting state: a few effects, Solid Color, red at half brightness. */
export function simVialRgb(
  overrides: Partial<NonNullable<SimLighting["vialrgb"]>> = {},
): SimLighting["vialrgb"] {
  return {
    version: 1,
    maxBrightness: 200,
    effects: [1, 2, 6, 13, 24, 29],
    mode: 2,
    speed: 128,
    hue: 0,
    sat: 255,
    val: 100,
    ...overrides,
  };
}

const snapshot = (s: SimLighting) => JSON.stringify({ b: s.backlight, r: s.rgblight, v: s.vialrgb });

/** Teaches a simulated keyboard the lighting commands for the kinds given. */
export function installLighting(
  sim: SimulatedKeyboard,
  initial: Omit<SimLighting, "saves" | "saved">,
): SimLighting {
  const state: SimLighting = structuredClone({ ...initial, saves: 0, saved: null });
  state.saved = snapshot(state);

  sim.handlers.push((msg) => {
    const [cmd, id] = msg;
    if (cmd === C.CMD_VIA_LIGHTING_SAVE) {
      state.saves++;
      state.saved = snapshot(state);
      return true;
    }
    if (cmd !== C.CMD_VIA_LIGHTING_GET_VALUE && cmd !== C.CMD_VIA_LIGHTING_SET_VALUE) return false;
    const get = cmd === C.CMD_VIA_LIGHTING_GET_VALUE;
    const { backlight: b, rgblight: r, vialrgb: v } = state;

    if (b && id === QMK_BACKLIGHT_BRIGHTNESS) {
      if (get) msg[2] = b.brightness;
      else b.brightness = msg[2];
      return true;
    }
    if (b && id === QMK_BACKLIGHT_EFFECT) {
      if (get) msg[2] = b.breathing ? 1 : 0;
      else b.breathing = msg[2] !== 0;
      return true;
    }
    if (r) {
      switch (id) {
        case QMK_RGBLIGHT_BRIGHTNESS:
          if (get) msg[2] = r.brightness;
          else r.brightness = msg[2];
          return true;
        case QMK_RGBLIGHT_EFFECT:
          if (get) msg[2] = r.effect;
          else r.effect = msg[2];
          return true;
        case QMK_RGBLIGHT_EFFECT_SPEED:
          if (get) msg[2] = r.speed;
          else r.speed = msg[2];
          return true;
        case QMK_RGBLIGHT_COLOR:
          if (get) msg.set([r.hue, r.sat], 2);
          else [r.hue, r.sat] = [msg[2], msg[3]];
          return true;
      }
    }
    if (v) {
      // vialrgb_get_value / vialrgb_set_value: args start at data[2].
      if (get && id === VIALRGB_GET_INFO) {
        msg.set([v.version & 0xff, v.version >> 8, v.maxBrightness], 2);
      } else if (get && id === VIALRGB_GET_MODE) {
        msg.set([v.mode & 0xff, v.mode >> 8, v.speed, v.hue, v.sat, v.val], 2);
      } else if (get && id === VIALRGB_GET_SUPPORTED) {
        // get_supported: fill with 0xFF, then the ids greater than gt, as many as fit.
        const gt = u16le(msg, 2);
        msg.fill(0xff, 2);
        let at = 2;
        for (const e of v.effects) {
          if (e > gt && at + 2 <= msg.length) {
            msg.set([e & 0xff, e >> 8], at);
            at += 2;
          }
        }
      } else if (!get && id === VIALRGB_SET_MODE) {
        v.mode = u16le(msg, 2);
        v.speed = msg[4];
        [v.hue, v.sat] = [msg[5], msg[6]];
        // rgb_matrix_sethsv_noeeprom clamps the value to RGB_MATRIX_MAXIMUM_BRIGHTNESS.
        v.val = Math.min(msg[7], v.maxBrightness);
      }
      // vialrgb.c leaves unknown sub-commands untouched; via.c doesn't mark them unhandled.
      return true;
    }
    return false;
  });
  return state;
}
