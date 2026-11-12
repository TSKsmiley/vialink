// SPDX-License-Identifier: GPL-2.0-or-later
// QMK settings commands (Vial protocol 4+), following vial-gui's
// protocol/keyboard_comm.py (reload_settings, qmk_settings_set,
// qmk_settings_reset) and vial-qmk's quantum/vial.c + quantum/qmk_settings.c:
// - get:   "<BBH" FE 0A qsid → reply status byte (0 = ok, 0xFF = unknown qsid,
//          qmk_settings_get() returns -1), then the value, little-endian;
// - set:   "<BBH" FE 0B qsid + value bytes (little-endian, width per
//          qmk_settings.json) → reply status byte (0 = ok);
// - reset: "BB" FE 0C → no reply data (vial.c leaves the report untouched).
// The supported-qsid query (FE 09) lives in commands.ts; Keyboard probes it.
//
// Widths and byte order follow editor/qmk_settings.py qsid_serialize /
// qsid_deserialize: int.to_bytes / int.from_bytes(width, byteorder="little").

import { bytes, le16 } from "../util/bytes.ts";
import * as C from "./constants.ts";
import type { Command } from "./commands.ts";

export interface QmkSettingReply {
  ok: boolean;
  status: number;
  /** Everything after the status byte; decode with {@link decodeQsidValue}. */
  data: Uint8Array;
}

/** Little-endian unsigned value of `width` bytes (qsid_serialize). Throws when it does not fit. */
export function encodeQsidValue(value: number, width: number): Uint8Array {
  if (!Number.isInteger(width) || width < 1 || width > 4) throw new RangeError(`unsupported width ${width}`);
  if (!Number.isInteger(value) || value < 0 || value > 2 ** (8 * width) - 1) {
    // Python's int.to_bytes raises OverflowError here.
    throw new RangeError(`value ${value} does not fit in ${width} byte(s)`);
  }
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i++) out[i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
  return out;
}

/** Little-endian unsigned value from the first `width` bytes (qsid_deserialize). */
export function decodeQsidValue(data: Uint8Array, width: number): number {
  let value = 0;
  for (let i = Math.min(width, data.length) - 1; i >= 0; i--) value = value * 256 + data[i];
  return value;
}

/** "<BBH" CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_GET, qsid → status byte, then the value. */
export const vialQmkSettingsGet: Command<[qsid: number], QmkSettingReply> = {
  encode: (qsid: number) => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_QMK_SETTINGS_GET, le16(qsid)),
  decode: (r) => ({ ok: r[0] === 0, status: r[0], data: r.slice(1) }),
};

/**
 * "<BBH" CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_SET, qsid, followed by
 * qsid_serialize(qsid, value) → status byte (0 = ok).
 */
export const vialQmkSettingsSet: Command<
  [qsid: number, value: number, width: number],
  { ok: boolean; status: number }
> = {
  encode: (qsid: number, value: number, width: number) =>
    bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_QMK_SETTINGS_SET, le16(qsid), encodeQsidValue(value, width)),
  decode: (r) => ({ ok: r[0] === 0, status: r[0] }),
};

/** "BB" CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_RESET; the reply carries nothing. */
export const vialQmkSettingsReset: Command<[], void> = {
  encode: () => bytes(C.CMD_VIA_VIAL_PREFIX, C.CMD_VIAL_QMK_SETTINGS_RESET),
  decode: () => undefined,
};
