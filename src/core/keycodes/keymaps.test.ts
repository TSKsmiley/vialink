// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBOARD_LAYOUT, findKeyboardLayout, KEYBOARD_LAYOUTS } from "./keymaps.ts";
import { KeycodeTable } from "./table.ts";

const table = (protocol: number) =>
  new KeycodeTable({ vialProtocol: protocol, layers: 4, macroCount: 16, tapDanceCount: 0 });

describe("keyboard layouts", () => {
  it("has vial-gui's list, US QWERTY first", () => {
    expect(KEYBOARD_LAYOUTS.length).toBe(34);
    expect(DEFAULT_KEYBOARD_LAYOUT).toEqual({ name: "QWERTY", labels: {} });
    expect(findKeyboardLayout("Danish (QWERTY)").labels.KC_SCOLON).toBe("Æ");
    expect(findKeyboardLayout("no such layout")).toBe(DEFAULT_KEYBOARD_LAYOUT);
  });

  // keymaps.py raises "Misconfigured - cannot find QMK keycode" on start-up for the same thing.
  for (const protocol of [5, 6]) {
    it(`only names keycodes that exist (protocol ${protocol})`, () => {
      const t = table(protocol);
      for (const layout of KEYBOARD_LAYOUTS) {
        for (const id of Object.keys(layout.labels)) {
          // Masked keycodes are named "RALT(kc)" in vial-gui and looked up without "(kc)".
          expect(t.find(id.replace("(kc)", ""))?.qmk_id, `${layout.name}: ${id}`).toBe(id);
        }
      }
    });
  }

  it("relabels keys, including the inner key of a masked keycode", () => {
    const t = table(6);
    const ae = t.parse("KC_SCOLON");
    const us = t.label(ae).text;
    expect(t.label(ae).overridden).toBe(false);

    t.setLabelOverrides(findKeyboardLayout("Danish (QWERTY)").labels);
    expect(t.label(ae)).toMatchObject({ text: "Æ", overridden: true });
    expect(t.label(t.parse("KC_A"))).toMatchObject({ text: "A", overridden: false });
    // LSFT(KC_7): the modifier label is unchanged, the inner key follows the layout.
    expect(t.label(t.parse("LSFT(KC_7)"))).toMatchObject({
      inner: "/\n7   {",
      overridden: false,
      innerOverridden: true,
    });
    expect(t.display(t.find("KC_QUOTE")!)).toEqual({ text: "Ø", overridden: true });

    t.setLabelOverrides(DEFAULT_KEYBOARD_LAYOUT.labels);
    expect(t.label(ae)).toMatchObject({ text: us, overridden: false });
  });
});
