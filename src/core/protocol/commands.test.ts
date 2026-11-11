// SPDX-License-Identifier: GPL-2.0-or-later
// Golden vectors per command. Request bytes follow the struct formats in
// vial-gui's keyboard_comm.py / dynamic.py / macro.py and the expectations of
// its test/test_keyboard.py SimulatedDevice; replies are as vial-qmk sends them.
// Replace or extend with vectors from real KLOR traces once they are recorded.

import { describe, expect, it } from "vitest";
import { fromHex, padTo, toHex, toTrimmedHex } from "../util/bytes.ts";
import * as cmd from "./commands.ts";

const reply = (hex: string) => padTo(fromHex(hex), 32);
const req = (data: Uint8Array) => toHex(data);

describe("command golden vectors", () => {
  it("VIA protocol version", () => {
    expect(req(cmd.viaGetProtocolVersion.encode())).toBe("01");
    expect(cmd.viaGetProtocolVersion.decode(reply("010009"))).toBe(9);
  });

  it("layer count", () => {
    expect(req(cmd.viaGetLayerCount.encode())).toBe("11");
    expect(cmd.viaGetLayerCount.decode(reply("1104"))).toBe(4);
  });

  it("single keycode get and set (big-endian keycode)", () => {
    expect(req(cmd.viaGetKeycode.encode(1, 2, 3))).toBe("04010203");
    expect(cmd.viaGetKeycode.decode(reply("040102030204"))).toBe(0x0204);
    expect(req(cmd.viaSetKeycode.encode(1, 2, 3, 0x7c00))).toBe("050102037c00");
  });

  it('keymap buffer get (">BHB" offset, size; data from byte 4)', () => {
    expect(req(cmd.viaKeymapGetBuffer.encode(56, 28))).toBe("1200381c");
    const r = reply("12001c04" + "00040005");
    expect(toHex(cmd.viaKeymapGetBuffer.decode(r))).toBe("00040005");
  });

  it("layout options (big-endian u32)", () => {
    expect(req(cmd.viaGetLayoutOptions.encode())).toBe("0202");
    expect(cmd.viaGetLayoutOptions.decode(reply("020200000003"))).toBe(3);
    expect(req(cmd.viaSetLayoutOptions.encode(0x01020304))).toBe("030201020304");
  });

  it("macro count and buffer size", () => {
    expect(req(cmd.viaMacroGetCount.encode())).toBe("0c");
    expect(cmd.viaMacroGetCount.decode(reply("0c10"))).toBe(16);
    expect(req(cmd.viaMacroGetBufferSize.encode())).toBe("0d");
    expect(cmd.viaMacroGetBufferSize.decode(reply("0d0400"))).toBe(1024);
  });

  it('Vial keyboard id ("<IQ", no echo)', () => {
    expect(req(cmd.vialGetKeyboardId.encode())).toBe("fe00");
    const id = cmd.vialGetKeyboardId.decode(reply("06000000" + "8877665544332211"));
    expect(id).toEqual({ vialProtocol: 6, uid: 0x1122334455667788n });
  });

  it("definition size and pages (little-endian)", () => {
    expect(req(cmd.vialGetDefinitionSize.encode())).toBe("fe01");
    expect(cmd.vialGetDefinitionSize.decode(reply("dc020000"))).toBe(732);
    expect(req(cmd.vialGetDefinitionPage.encode(0x0102))).toBe("fe0202010000");
  });

  it("encoder get and set", () => {
    expect(req(cmd.vialGetEncoder.encode(2, 1))).toBe("fe030201");
    expect(cmd.vialGetEncoder.decode(reply("00800081"))).toEqual([0x80, 0x81]);
    expect(req(cmd.vialSetEncoder.encode(2, 1, 1, 0x00e9))).toBe("fe0402010100e9");
  });

  it("unlock status", () => {
    expect(req(cmd.vialGetUnlockStatus.encode())).toBe("fe05");
    const s = cmd.vialGetUnlockStatus.decode(padTo(fromHex("0000" + "0000" + "0001" + "ff".repeat(26)), 32));
    expect(s).toEqual({
      unlocked: false,
      inProgress: false,
      keys: [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ],
    });
  });

  it("dynamic entry counts and feature bits (data[-1])", () => {
    expect(req(cmd.vialGetDynamicEntryCounts.encode())).toBe("fe0d00");
    const r = reply("04080401");
    r[31] = 0b11;
    expect(cmd.vialGetDynamicEntryCounts.decode(r)).toEqual({
      tapDance: 4,
      combo: 8,
      keyOverride: 4,
      altRepeatKey: 1,
      featureFlags: 3,
    });
  });

  it('QMK settings query ("<BBH")', () => {
    expect(req(cmd.vialQmkSettingsQuery.encode(0x0107))).toBe("fe090701");
    const ids = cmd.vialQmkSettingsQuery.decode(padTo(fromHex("010002000700" + "ff".repeat(26)), 32));
    expect(ids.slice(0, 4)).toEqual([1, 2, 7, 0xffff]);
  });

  it("layer name get (Theis194 extension)", () => {
    expect(req(cmd.vialGetLayerName.encode(3))).toBe("fe0d0903");
    const ok = cmd.vialGetLayerName.decode(reply("00" + toHex(new TextEncoder().encode("Nav"))));
    expect(ok).toEqual({ ok: true, status: 0, name: "Nav" });
    // Stock Vial leaves the request untouched, so the first byte stays 0xFE.
    expect(cmd.vialGetLayerName.decode(reply("fe0d0900")).ok).toBe(false);
  });

  it("trims trailing zeros for traces", () => {
    expect(toTrimmedHex(padTo(fromHex("fe0d00"), 32))).toBe("fe0d");
  });
});
