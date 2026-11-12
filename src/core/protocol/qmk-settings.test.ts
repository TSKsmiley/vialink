// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { toHex } from "../util/bytes.ts";
import {
  decodeQsidValue,
  encodeQsidValue,
  vialQmkSettingsGet,
  vialQmkSettingsReset,
  vialQmkSettingsSet,
} from "./qmk-settings.ts";

const reply = (...head: number[]) => {
  const r = new Uint8Array(32);
  r.set(head);
  return r;
};

describe("QMK settings commands", () => {
  it('encodes get as struct.pack("<BBH", 0xFE, 0x0A, qsid)', () => {
    expect(toHex(vialQmkSettingsGet.encode(7))).toBe("fe0a0700");
    expect(toHex(vialQmkSettingsGet.encode(0x1234))).toBe("fe0a3412");
  });

  it("decodes a get reply: status byte, then the value little-endian", () => {
    const ok = vialQmkSettingsGet.decode(reply(0x00, 0xc8, 0x00));
    expect(ok.ok).toBe(true);
    expect(decodeQsidValue(ok.data, 2)).toBe(200);
    // Magic (qsid 21) is a 4-byte bit field.
    expect(decodeQsidValue(vialQmkSettingsGet.decode(reply(0, 0x81, 0x02, 0, 0)).data, 4)).toBe(0x281);
    // qmk_settings_get returns -1 for an unknown qsid: 0xFF in the status byte.
    const bad = vialQmkSettingsGet.decode(reply(0xff));
    expect(bad).toMatchObject({ ok: false, status: 0xff });
  });

  it('encodes set as struct.pack("<BBH", 0xFE, 0x0B, qsid) + qsid_serialize(value)', () => {
    // Tapping term (qsid 7, width 2) = 200
    expect(toHex(vialQmkSettingsSet.encode(7, 200, 2))).toBe("fe0b0700c800");
    // Tapping toggle (qsid 20, width 1) = 5
    expect(toHex(vialQmkSettingsSet.encode(20, 5, 1))).toBe("fe0b140005");
    // Magic (qsid 21, width 4) with bits 0 and 9
    expect(toHex(vialQmkSettingsSet.encode(21, 0x201, 4))).toBe("fe0b150001020000");
    expect(vialQmkSettingsSet.decode(reply(0))).toEqual({ ok: true, status: 0 });
    expect(vialQmkSettingsSet.decode(reply(0xff))).toEqual({ ok: false, status: 0xff });
  });

  it('encodes reset as struct.pack("BB", 0xFE, 0x0C)', () => {
    expect(toHex(vialQmkSettingsReset.encode())).toBe("fe0c");
  });

  it("refuses values that int.to_bytes would overflow on", () => {
    expect(toHex(encodeQsidValue(0xffffffff, 4))).toBe("ffffffff");
    expect(() => encodeQsidValue(256, 1)).toThrow(RangeError);
    expect(() => encodeQsidValue(-1, 2)).toThrow(RangeError);
    expect(() => encodeQsidValue(1.5, 2)).toThrow(RangeError);
    expect(decodeQsidValue(Uint8Array.of(0xff, 0xff, 0xff, 0xff), 4)).toBe(0xffffffff);
  });
});
