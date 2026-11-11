// SPDX-License-Identifier: GPL-2.0-or-later
// Golden vectors worked out by hand from vial-gui's protocol/combo.py:
//   struct.pack("BBBB", 0xFE, 0x0D, 0x04, idx) + struct.pack("<HHHHH", *entry)
import { describe, expect, it } from "vitest";
import { fromHex, padTo, toHex } from "../util/bytes.ts";
import { packComboEntry, unpackComboEntry, vialComboGet, vialComboSet } from "./combos.ts";

describe("combo commands", () => {
  it("encodes the get request as FE 0D 03 idx", () => {
    expect(toHex(vialComboGet.encode(0))).toBe("fe0d0300");
    expect(toHex(vialComboGet.encode(31))).toBe("fe0d031f");
  });

  it("decodes a get reply: status byte, then <HHHHH", () => {
    // KC_A (0x0004), KC_S (0x0016), KC_NO, KC_NO → KC_ESC (0x0029)
    const reply = padTo(fromHex("00" + "0400" + "1600" + "0000" + "0000" + "2900"), 32);
    expect(vialComboGet.decode(reply)).toEqual({ ok: true, status: 0, entry: [4, 0x16, 0, 0, 0x29] });
    // Masked keycodes are little-endian too: LCTL(KC_C) = 0x0106, QK_BOOT (v6) = 0x7C00.
    const masked = padTo(fromHex("00" + "0601" + "0000" + "0000" + "0000" + "007c"), 32);
    expect(vialComboGet.decode(masked).entry).toEqual([0x0106, 0, 0, 0, 0x7c00]);
  });

  it("reports a failed get (index past VIAL_COMBO_ENTRIES returns -1)", () => {
    const reply = padTo(fromHex("ff"), 32);
    expect(vialComboGet.decode(reply)).toMatchObject({ ok: false, status: 0xff });
  });

  it("encodes the set request as FE 0D 04 idx + <HHHHH", () => {
    expect(toHex(vialComboSet.encode(2, [4, 0x16, 0, 0, 0x29]))).toBe(
      "fe0d0402" + "0400" + "1600" + "0000" + "0000" + "2900",
    );
    expect(toHex(vialComboSet.encode(7, [0x0106, 0x0204, 0xffff, 0, 0x7c00]))).toBe(
      "fe0d0407" + "0601" + "0402" + "ffff" + "0000" + "007c",
    );
  });

  it("decodes the set status", () => {
    expect(vialComboSet.decode(padTo(fromHex("00"), 32))).toEqual({ ok: true, status: 0 });
    expect(vialComboSet.decode(padTo(fromHex("ff"), 32))).toEqual({ ok: false, status: 0xff });
  });

  it("packs exactly sizeof(vial_combo_entry_t) = 10 bytes and round-trips", () => {
    const entry: [number, number, number, number, number] = [1, 0x1234, 0xabcd, 0xffff, 0x7c00];
    const packed = packComboEntry(entry);
    expect(packed.length).toBe(10);
    expect(unpackComboEntry(packed)).toEqual(entry);
  });
});
