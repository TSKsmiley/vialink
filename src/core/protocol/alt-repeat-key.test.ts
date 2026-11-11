// SPDX-License-Identifier: GPL-2.0-or-later
// Golden vectors for the alt repeat key commands. Requests follow vial-gui's
// protocol/alt_repeat_key.py (struct.pack("BBBB", ...) + "<HHBB"); replies are
// laid out as vial-qmk's vial.c sends them (status, then the entry).

import { describe, expect, it } from "vitest";
import { fromHex, padTo, toHex } from "../util/bytes.ts";
import {
  altRepeatKeyEntriesEqual,
  packAltRepeatKeyEntry,
  vialAltRepeatKeyGet,
  vialAltRepeatKeySet,
} from "./alt-repeat-key.ts";

const reply = (hex: string) => padTo(fromHex(hex), 32);

describe("alt repeat key golden vectors", () => {
  it("packs an entry as struct.pack('<HHBB', ...)", () => {
    // struct.pack("<HHBB", 0x0004, 0x0205, 0x11, 0x09)
    const entry = { keycode: 4, altKeycode: 0x0205, allowedMods: 0x11, options: 9 };
    expect(toHex(packAltRepeatKeyEntry(entry))).toBe("040005021109");
  });

  it("get: request and reply decoding", () => {
    expect(toHex(vialAltRepeatKeyGet.encode(3))).toBe("fe0d0703");
    expect(vialAltRepeatKeyGet.decode(reply("00" + "1d00" + "0602" + "22" + "0b"))).toEqual({
      ok: true,
      status: 0,
      entry: { keycode: 0x001d, altKeycode: 0x0206, allowedMods: 0x22, options: 0x0b },
    });
    // AltRepeatKeyOptions keeps bits 0-3 only.
    expect(vialAltRepeatKeyGet.decode(reply("00" + "0000" + "0000" + "00" + "f8")).entry.options).toBe(0x08);
    // dynamic_keymap_get_alt_repeat_key returns -1 for an index out of range.
    expect(vialAltRepeatKeyGet.decode(reply("ff")).ok).toBe(false);
  });

  it("set: request and status", () => {
    const entry = { keycode: 0x7c00, altKeycode: 0x0004, allowedMods: 0x80, options: 0x0f };
    expect(toHex(vialAltRepeatKeySet.encode(1, entry))).toBe("fe0d0801" + "007c" + "0400" + "80" + "0f");
    expect(vialAltRepeatKeySet.decode(reply("00"))).toEqual({ ok: true, status: 0 });
    expect(vialAltRepeatKeySet.decode(reply("ff"))).toEqual({ ok: false, status: 0xff });
  });

  it("compares entries by their packed bytes", () => {
    const a = { keycode: 4, altKeycode: 5, allowedMods: 0, options: 0x18 };
    expect(altRepeatKeyEntriesEqual(a, { ...a, options: 0x08 })).toBe(true);
    expect(altRepeatKeyEntriesEqual(a, { ...a, allowedMods: 1 })).toBe(false);
  });
});
