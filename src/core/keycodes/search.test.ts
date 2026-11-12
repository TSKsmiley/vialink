// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { KeycodeTable } from "./table.ts";
import { parseTypedKey, searchKeycodes } from "./search.ts";

for (const vialProtocol of [5, 6]) {
  const table = new KeycodeTable({ vialProtocol, layers: 8, macroCount: 16, tapDanceCount: 8 });

  describe(`keycode search (protocol ${vialProtocol})`, () => {
    it("finds every keycode of every picker group by its id", () => {
      // Done-when of redesign phase 2: whatever the tabbed picker offers, search reaches.
      for (const group of table.groups()) {
        for (const kc of group.keycodes) {
          const hits = searchKeycodes(table, kc.qmk_id);
          expect(
            hits.map((h) => h.qmk_id),
            `${group.id}: ${kc.qmk_id}`,
          ).toContain(kc.qmk_id);
          expect(hits[0].value, kc.qmk_id).toBe(kc.value);
        }
      }
    });

    it("ranks exact names and aliases first", () => {
      expect(searchKeycodes(table, "esc")[0].qmk_id).toBe("KC_ESCAPE");
      expect(searchKeycodes(table, "KC_SPC")[0].qmk_id).toBe("KC_SPACE");
      expect(searchKeycodes(table, "a")[0].qmk_id).toBe("KC_A");
      expect(searchKeycodes(table, "  ")).toEqual([]);
    });

    it("reads shortcuts and expressions", () => {
      expect(parseTypedKey(table, "ctrl+c")?.code).toBe(table.parse("LCTL(KC_C)"));
      expect(parseTypedKey(table, "Ctrl+Shift+Esc")?.code).toBe(table.parse("LCTL(LSFT(KC_ESCAPE))"));
      expect(parseTypedKey(table, "LT(1, KC_SPC)")?.code).toBe(table.parse("LT(1, KC_SPACE)"));
      expect(parseTypedKey(table, "KC_A")?.code).toBe(4);
      expect(parseTypedKey(table, "esc")).toBeNull(); // a search, not a keycode
      expect(parseTypedKey(table, "ctrl+nonsense")).toBeNull();
      expect(parseTypedKey(table, "LT(99")).toBeNull();
    });
  });
}
