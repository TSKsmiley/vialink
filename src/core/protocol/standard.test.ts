// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import * as commands from "./commands.ts";
import { isStandardCommand, startsWith } from "./standard.ts";

describe("standard Vial commands", () => {
  it("include every command ViaLink sends for standard features, and not the layer-names fork's", () => {
    expect(isStandardCommand(commands.viaGetProtocolVersion.encode())).toBe(true);
    expect(isStandardCommand(commands.viaSetKeycode.encode(0, 1, 2, 4))).toBe(true);
    expect(isStandardCommand(commands.vialGetKeyboardId.encode())).toBe(true);
    expect(isStandardCommand(commands.vialGetDynamicEntryCounts.encode())).toBe(true);
    expect(isStandardCommand(commands.vialUnlockStart.encode())).toBe(true);
    expect(isStandardCommand(commands.vialGetLayerName.encode(0))).toBe(false);
    expect(isStandardCommand(commands.vialSetLayerName.encode(0, "Nav"))).toBe(false);
    expect(isStandardCommand(Uint8Array.of(0x0b))).toBe(false); // bootloader jump: vial-gui doesn't send it
    expect(isStandardCommand(Uint8Array.of(0xfe, 0x42))).toBe(false);
  });

  it("matches a declared prefix", () => {
    expect(startsWith(Uint8Array.of(0xfe, 0x0d, 0x09, 1), [0xfe, 0x0d, 0x09])).toBe(true);
    expect(startsWith(Uint8Array.of(0xfe, 0x0d, 0x0a), [0xfe, 0x0d, 0x09])).toBe(false);
    expect(startsWith(Uint8Array.of(0xfe), [])).toBe(false);
  });
});
