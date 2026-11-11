// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { KeycodeTable } from "./table.ts";

// Same configuration as vial-gui's test/test_keycode.py FakeKeyboard.
const table = (protocol: number) =>
  new KeycodeTable({
    vialProtocol: protocol,
    layers: 4,
    macroCount: 16,
    tapDanceCount: 0,
    supportedFeatures:
      protocol >= 6 ? ["persistent_default_layer", "caps_word", "layer_lock", "repeat_key"] : [],
  });

describe("KeycodeTable", () => {
  // Port of vial-gui's _test_serialize_protocol: every 16-bit value round-trips.
  for (const protocol of [5, 6]) {
    it(`round-trips all 65536 keycodes (protocol ${protocol})`, () => {
      const t = table(protocol);
      for (let x = 0; x < 0x10000; x++) {
        const s = t.serialize(x);
        expect(t.deserialize(s), `${x} -> ${s}`).toBe(x);
      }
    });
  }

  it("decodes composite v6 keycodes", () => {
    const t = table(6);
    expect(t.deserialize("KC_A")).toBe(0x04);
    expect(t.serialize(0x0204)).toBe("LSFT(KC_A)");
    expect(t.deserialize("LT1(KC_A)")).toBe(0x4104);
    expect(t.deserialize("LT(2, KC_SPC)")).toBe(0x422c);
    expect(t.deserialize("MT(MOD_LCTL | MOD_LSFT, KC_ESC)")).toBe(0x2329);
    expect(t.serialize(0x5221)).toBe("MO(1)");
    expect(t.serialize(0x7702)).toBe("M2");
    expect(t.deserialize("TD(3)")).toBe(0x5703);
    expect(t.deserialize("QK_BOOT")).toBe(0x7c00);
    expect(t.serialize(0x7e00)).toBe("USER00");
    expect(t.deserialize("KC_PERC")).toBe(0x0222);
    expect(t.deserialize("not a keycode")).toBe(0);
  });

  it("labels masked keycodes with their inner key", () => {
    const l = table(6).label(0x0204);
    expect(l.text).toBe("LSft");
    expect(l.inner).toBe("A");
  });
});
