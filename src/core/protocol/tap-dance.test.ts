// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { padTo, toHex } from "../util/bytes.ts";
import { packTapDanceEntry, unpackTapDanceEntry, vialTapDanceGet, vialTapDanceSet } from "./tap-dance.ts";

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

// KC_A, KC_LCTL, KC_B, LSFT(KC_C), 200 ms as struct.pack("<HHHHH", ...).
const ENTRY = { onTap: 0x0004, onHold: 0x00e0, onDoubleTap: 0x0005, onTapHold: 0x0206, tappingTerm: 200 };
const PACKED = "0400" + "e000" + "0500" + "0602" + "c800";

describe("tap dance commands", () => {
  it("packs entries little-endian in struct order", () => {
    expect(toHex(packTapDanceEntry(ENTRY))).toBe(PACKED);
    expect(unpackTapDanceEntry(hex(PACKED))).toEqual(ENTRY);
    expect(toHex(packTapDanceEntry({ ...ENTRY, tappingTerm: 0xffff }))).toBe(PACKED.slice(0, 16) + "ffff");
  });

  it("encodes the get request and decodes its reply", () => {
    expect(toHex(vialTapDanceGet.encode(3))).toBe("fe0d0103");
    const reply = padTo(hex("00" + PACKED), 32);
    expect(vialTapDanceGet.decode(reply)).toEqual({ ok: true, status: 0, entry: ENTRY });
    const missing = vialTapDanceGet.decode(padTo(hex("ff"), 32));
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe(0xff);
  });

  it("encodes the set request and decodes its status", () => {
    expect(toHex(vialTapDanceSet.encode(2, ENTRY))).toBe("fe0d0202" + PACKED);
    expect(vialTapDanceSet.decode(padTo(hex("00"), 32))).toEqual({ ok: true, status: 0 });
    expect(vialTapDanceSet.decode(padTo(hex("ff"), 32))).toEqual({ ok: false, status: 0xff });
  });
});
