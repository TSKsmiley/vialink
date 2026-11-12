// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { fromHex, padTo, toHex } from "../util/bytes.ts";
import {
  KO_ENABLED,
  KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP,
  KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN,
  KO_OPTION_ACTIVATION_TRIGGER_DOWN,
  KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN,
  packKeyOverride,
  unpackKeyOverride,
  vialKeyOverrideGet,
  vialKeyOverrideSet,
  type KeyOverrideEntry,
} from "./key-overrides.ts";

// KC_A → LSFT(KC_B) on layers 0 and 2 while LShift is held, unless LCtrl is;
// LShift is suppressed; trigger-down activation, enabled.
const sample: KeyOverrideEntry = {
  trigger: 0x0004,
  replacement: 0x0205,
  layers: 0x0005,
  triggerMods: 0x02,
  negativeModMask: 0x01,
  suppressedMods: 0x02,
  options: KO_ENABLED | KO_OPTION_ACTIVATION_TRIGGER_DOWN,
};
// struct.pack("<HHHBBBB", 4, 0x205, 5, 2, 1, 2, 0x81)
const sampleHex = "0400" + "0502" + "0500" + "02" + "01" + "02" + "81";

describe("key override protocol", () => {
  it("packs vial_key_override_entry_t as <HHHBBBB (10 bytes, little-endian)", () => {
    expect(toHex(packKeyOverride(sample))).toBe(sampleHex);
    expect(unpackKeyOverride(fromHex(sampleHex))).toEqual(sample);
    expect(
      toHex(
        packKeyOverride({
          trigger: 0x7c00,
          replacement: 0xabcd,
          layers: 0xffff,
          triggerMods: 0xff,
          negativeModMask: 0x80,
          suppressedMods: 0x10,
          options: 0xff,
        }),
      ),
    ).toBe("007c" + "cdab" + "ffff" + "ff8010ff");
  });

  it("matches vial-gui's option bits", () => {
    expect(KO_OPTION_ACTIVATION_TRIGGER_DOWN).toBe(1);
    expect(KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN).toBe(2);
    expect(KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP).toBe(4);
    expect(KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN).toBe(32);
    expect(KO_ENABLED).toBe(128);
  });

  it("encodes get as FE 0D 05 idx and decodes status + entry", () => {
    expect(toHex(vialKeyOverrideGet.encode(3))).toBe("fe0d0503");
    const reply = padTo(fromHex("00" + sampleHex), 32);
    expect(vialKeyOverrideGet.decode(reply)).toEqual({ ok: true, status: 0, entry: sample });
    // An index beyond the count: dynamic_keymap_get_key_override returns -1.
    expect(vialKeyOverrideGet.decode(padTo(fromHex("ff"), 32)).ok).toBe(false);
    // Firmware without the sub-command leaves the request untouched.
    expect(vialKeyOverrideGet.decode(padTo(fromHex("fe0d0500"), 32))).toMatchObject({
      ok: false,
      status: 0xfe,
    });
  });

  it("encodes set as FE 0D 06 idx + entry and decodes the status", () => {
    expect(toHex(vialKeyOverrideSet.encode(1, sample))).toBe("fe0d0601" + sampleHex);
    expect(vialKeyOverrideSet.decode(padTo(fromHex("00"), 32))).toEqual({ ok: true, status: 0 });
    expect(vialKeyOverrideSet.decode(padTo(fromHex("ff"), 32))).toEqual({ ok: false, status: 0xff });
  });
});
