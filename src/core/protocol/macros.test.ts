// SPDX-License-Identifier: GPL-2.0-or-later
// Golden vectors ported from vial-gui's src/main/python/test/test_macro.py,
// plus the buffer commands and clean-up of protocol/macro.py.
import { describe, expect, it } from "vitest";
import { KeycodeTable } from "../keycodes/table.ts";
import { fromHex, toHex } from "../util/bytes.ts";
import {
  cleanMacroBuffer,
  deserializeMacro,
  deserializeMacros,
  enoughMacrosRead,
  MacroError,
  restoreMacroAction,
  saveMacroAction,
  serializeMacro,
  serializeMacros,
  splitNul,
  viaMacroGetBuffer,
  viaMacroSetBuffer,
  type MacroAction,
} from "./macros.ts";

const table = (protocol: number) =>
  new KeycodeTable({ vialProtocol: protocol, layers: 4, macroCount: 16, tapDanceCount: 0 });
const ascii = (s: string) => new TextEncoder().encode(s);
const b = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...ascii(p)] : p)));

const text = (t: string): MacroAction => ({ type: "text", text: t });
const tap = (...keys: string[]): MacroAction => ({ type: "tap", keys });
const down = (...keys: string[]): MacroAction => ({ type: "down", keys });
const up = (...keys: string[]): MacroAction => ({ type: "up", keys });
const delay = (ms: number): MacroAction => ({ type: "delay", delay: ms });

describe("macro buffer commands", () => {
  it("encodes get-buffer as >BHB and decodes the data at byte 4", () => {
    expect(toHex(viaMacroGetBuffer.encode(0x0123, 28))).toBe("0e01231c");
    const reply = fromHex("0e00001c" + "41".repeat(28));
    expect(viaMacroGetBuffer.decode(reply)).toEqual(new Uint8Array(28).fill(0x41));
    expect(viaMacroGetBuffer.decode(fromHex("0e001c03" + "616263" + "00".repeat(25)))).toEqual(ascii("abc"));
  });

  it("encodes set-buffer as >BHB plus the chunk, at most 28 bytes", () => {
    expect(toHex(viaMacroSetBuffer.encode(0x0038, ascii("hi\0")))).toBe("0f003803" + "686900");
    expect(() => viaMacroSetBuffer.encode(0, new Uint8Array(29))).toThrow(MacroError);
  });
});

describe("macro format v1 (Vial protocol < 2)", () => {
  const kc = table(1);
  const bytesV1 = b("Hello", [1, 4, 1, 5, 1, 6], "World", [2, 6, 2, 5, 2, 4]);
  const actions = [text("Hello"), tap("KC_A", "KC_B", "KC_C"), text("World"), down("KC_C", "KC_B", "KC_A")];

  it("serializes (test_serialize_v1)", () => {
    expect(serializeMacro(actions, 1, kc)).toEqual(bytesV1);
  });

  it("deserializes (test_deserialize_v1)", () => {
    expect(deserializeMacro(bytesV1, 1, kc)).toEqual(actions);
  });

  it("refuses delays, as ActionDelay.serialize does", () => {
    expect(() => serializeMacro([delay(5)], 1, kc)).toThrow(MacroError);
  });

  it("stops at a truncated code", () => {
    expect(deserializeMacro(b("a", [1]), 1, kc)).toEqual([text("a")]);
  });
});

describe("macro format v2 (Vial protocol >= 2)", () => {
  const kc = table(2);
  const head = b("Hello", [1, 1, 4, 1, 1, 5, 1, 1, 6], "World", [1, 2, 6, 1, 2, 5, 1, 2, 4]);
  const actions = [text("Hello"), tap("KC_A", "KC_B", "KC_C"), text("World"), down("KC_C", "KC_B", "KC_A")];

  for (const [ms, tail] of [
    [1000, [1, 4, 0xec, 4]],
    [0, [1, 4, 1, 1]],
    [1, [1, 4, 2, 1]],
    [256, [1, 4, 2, 2]],
  ] as const) {
    it(`serializes and deserializes a ${ms} ms delay (test_serialize_v2/test_deserialize_v2)`, () => {
      const data = b([...head, ...tail]);
      expect(serializeMacro([...actions, delay(ms)], 2, kc)).toEqual(data);
      expect(deserializeMacro(data, 2, kc)).toEqual([...actions, delay(ms)]);
    });
  }

  it("encodes the largest delay struct.pack accepts and refuses bigger ones", () => {
    expect(serializeMacro([delay(65024)], 2, kc)).toEqual(Uint8Array.of(1, 4, 255, 255));
    expect(() => serializeMacro([delay(65025)], 2, kc)).toThrow(MacroError);
  });

  it("uses 2-byte extended keycodes (test_twobyte_keycodes)", () => {
    expect(serializeMacro([tap("CMB_TOG", "KC_A")], 2, kc)).toEqual(Uint8Array.of(1, 5, 0xf9, 0x5c, 1, 1, 4));
    expect(serializeMacro([down("CMB_TOG", "KC_A")], 2, kc)).toEqual(
      Uint8Array.of(1, 6, 0xf9, 0x5c, 1, 2, 4),
    );
    expect(serializeMacro([up("CMB_TOG", "KC_A")], 2, kc)).toEqual(Uint8Array.of(1, 7, 0xf9, 0x5c, 1, 3, 4));
    expect(deserializeMacro(Uint8Array.of(1, 5, 0xf9, 0x5c, 1, 1, 4), 2, kc)).toEqual([
      tap("CMB_TOG", "KC_A"),
    ]);
    expect(deserializeMacro(Uint8Array.of(1, 6, 0xf9, 0x5c, 1, 2, 4), 2, kc)).toEqual([
      down("CMB_TOG", "KC_A"),
    ]);
    expect(deserializeMacro(Uint8Array.of(1, 7, 0xf9, 0x5c, 1, 3, 4), 2, kc)).toEqual([
      up("CMB_TOG", "KC_A"),
    ]);
  });

  it("maps 0xXX00 keycodes to 0xFFXX and back (test_twobyte_with_zeroes)", () => {
    const keys = [0xa000, 0xb100, 0xc200].map((c) => kc.serialize(c));
    expect(serializeMacro([tap(...keys)], 2, kc)).toEqual(
      Uint8Array.of(1, 5, 0xa0, 0xff, 1, 5, 0xb1, 0xff, 1, 5, 0xc2, 0xff),
    );
    expect(
      deserializeMacro(Uint8Array.of(1, 5, 0xc2, 0xff, 1, 5, 0xb1, 0xff, 1, 5, 0xa0, 0xff), 2, kc),
    ).toEqual([tap(...[...keys].reverse())]);
  });

  it("works with protocol 6 keycodes (QK_* ranges moved)", () => {
    const kc6 = table(6);
    const code = kc6.parse("LSFT(KC_A)");
    expect(code).toBe(0x0204);
    expect(serializeMacro([tap("LSFT(KC_A)")], 6, kc6)).toEqual(Uint8Array.of(1, 5, 0x04, 0x02));
    expect(deserializeMacro(Uint8Array.of(1, 5, 0x04, 0x02), 6, kc6)).toEqual([tap("LSFT(KC_A)")]);
  });

  it("skips malformed codes two bytes at a time and stops at truncated ones", () => {
    expect(deserializeMacro(b([1, 9], "ab"), 2, kc)).toEqual([text("ab")]);
    expect(deserializeMacro(b("x", [1, 5, 4]), 2, kc)).toEqual([text("x")]);
    expect(deserializeMacro(b("x", [1, 4, 2]), 2, kc)).toEqual([text("x")]);
  });

  it("encodes text as UTF-8 but decodes it one byte per character, like vial-gui", () => {
    expect(serializeMacro([text("é")], 2, kc)).toEqual(Uint8Array.of(0xc3, 0xa9));
    expect(deserializeMacro(Uint8Array.of(0xc3, 0xa9), 2, kc)).toEqual([text("Ã©")]);
  });
});

describe("macro buffers", () => {
  const kc = table(6);

  it("splits like bytes.split and cleans up to exactly macro_count macros", () => {
    expect(splitNul(Uint8Array.of(0, 0x41, 0)).map((p) => [...p])).toEqual([[], [0x41], []]);
    // Garbage after the last macro is dropped; missing macros become empty.
    expect([...cleanMacroBuffer(b("ab", [0], "c", [0], "junk"), 2)]).toEqual([...b("ab", [0], "c", [0])]);
    expect([...cleanMacroBuffer(b("ab"), 3)]).toEqual([...b("ab", [0, 0, 0])]);
    expect(enoughMacrosRead(Uint8Array.of(0, 0), 2)).toBe(false);
    expect(enoughMacrosRead(Uint8Array.of(0, 0, 0), 2)).toBe(true);
  });

  it("serializes every macro NUL-terminated and checks the count", () => {
    expect(serializeMacros([[text("a")], [], [tap("KC_B")]], 3, 6, kc)).toEqual(b("a", [0, 0, 1, 1, 5, 0]));
    expect(() => serializeMacros([[]], 2, 6, kc)).toThrow(MacroError);
    expect(deserializeMacros(b("a", [0, 0, 1, 1, 5, 0]), 4, 6, kc)).toEqual([
      [text("a")],
      [],
      [tap("KC_B")],
      [],
    ]);
  });
});

describe("macro .vil actions", () => {
  it("saves with vial-gui's tags (test_save)", () => {
    expect(saveMacroAction(down("KC_A", "KC_B", "CMB_TOG"))).toEqual(["down", "KC_A", "KC_B", "CMB_TOG"]);
    expect(saveMacroAction(tap("CMB_TOG", "KC_B", "KC_A"))).toEqual(["tap", "CMB_TOG", "KC_B", "KC_A"]);
    expect(saveMacroAction(text("Hello world"))).toEqual(["text", "Hello world"]);
    expect(saveMacroAction(delay(123))).toEqual(["delay", 123]);
  });

  it("restores them (test_restore) and skips unknown tags", () => {
    expect(restoreMacroAction(["down", "KC_A", "KC_B", "CMB_TOG"])).toEqual(down("KC_A", "KC_B", "CMB_TOG"));
    expect(restoreMacroAction(["tap", "CMB_TOG", "KC_B", "KC_A"])).toEqual(tap("CMB_TOG", "KC_B", "KC_A"));
    expect(restoreMacroAction(["text", "Hello world"])).toEqual(text("Hello world"));
    expect(restoreMacroAction(["delay", 123])).toEqual(delay(123));
    expect(restoreMacroAction(["beep", 1])).toBeNull();
    expect(restoreMacroAction("text")).toBeNull();
    expect(restoreMacroAction(["text", 5])).toBeNull();
  });
});
