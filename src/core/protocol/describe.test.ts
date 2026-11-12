// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import * as C from "./constants.ts";
import { describeRequest, isRejected } from "./describe.ts";

describe("readable command names", () => {
  it("names every command ViaLink sends", () => {
    const entries = Object.entries(C).filter(([, v]) => typeof v === "number") as [string, number][];
    const via = entries.filter(([k]) => k.startsWith("CMD_VIA_") && k !== "CMD_VIA_VIAL_PREFIX");
    const vial = entries.filter(([k]) => k.startsWith("CMD_VIAL_"));
    const dynamic = entries.filter(([k]) => k.startsWith("DYNAMIC_VIAL_"));
    expect(via.length + vial.length + dynamic.length).toBeGreaterThan(30);
    for (const [name, code] of via) {
      expect(describeRequest(Uint8Array.of(code, 0, 0, 0, 0, 0)).name, name).not.toMatch(/Unknown/);
    }
    for (const [name, code] of vial) {
      expect(describeRequest(Uint8Array.of(0xfe, code, 0, 0, 0, 0, 0)).name, name).not.toMatch(
        /Unknown|dynamic entry op/,
      );
    }
    for (const [name, op] of dynamic) {
      expect(describeRequest(Uint8Array.of(0xfe, 0x0d, op, 0)).name, name).not.toMatch(
        /Unknown|dynamic entry op/,
      );
    }
  });

  it("describes arguments and kinds", () => {
    const setKey = describeRequest(Uint8Array.of(0x05, 1, 3, 2, 0x41, 0x2c), (c) =>
      c === 0x412c ? "LT1(KC_SPACE)" : "?",
    );
    expect(setKey).toEqual({ name: "Set key L1 R3 C2 → LT1(KC_SPACE)", kind: "write" });
    expect(describeRequest(Uint8Array.of(0x04, 0, 1, 2)).kind).toBe("read");
    expect(describeRequest(Uint8Array.of(0xfe, 0x0d, 0x02, 3)).name).toBe("Set tap dance 3");
    expect(describeRequest(Uint8Array.of(0xfe, 0x07)).kind).toBe("poll");
    expect(describeRequest(Uint8Array.of(0x02, 0x03)).kind).toBe("poll");
    expect(describeRequest(Uint8Array.of(0xfe, 0x06)).kind).toBe("unlock");
    expect(describeRequest(Uint8Array.of(0x77)).name).toBe("Unknown command 0x77");
  });

  it("spots refused writes", () => {
    expect(isRejected(Uint8Array.of(0xfe, 0x0d, 0x02), Uint8Array.of(0xff))).toBe(true);
    expect(isRejected(Uint8Array.of(0xfe, 0x0d, 0x02), Uint8Array.of(0x00))).toBe(false);
    expect(isRejected(Uint8Array.of(0x05, 0, 0, 0), Uint8Array.of(0xff))).toBe(false);
  });
});
