// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import {
  keyBoxes,
  keysBetween,
  keysText,
  parseKeysText,
  planKeyPaste,
  targetsInBox,
  type KeyTarget,
} from "./keyPaste.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";

const A = 0x04;
const B = 0x05;
const C = 0x06;

// The 2x2 test board: keys 0,0 0,1 on top, 1,0 1,1 below, then an encoder to the right.
async function board() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
}

const key = (row: number, col: number): KeyTarget => ({ kind: "key", row, col });
const names = (ts: readonly KeyTarget[]) =>
  ts.map((t) => (t.kind === "key" ? `${t.row},${t.col}` : `e${t.index}.${t.direction}`)).sort();

describe("where keys are", () => {
  it("knows every key and encoder direction as drawn", async () => {
    const kb = await board();
    const boxes = keyBoxes(kb);
    expect(names(boxes.map((b) => b.target))).toEqual(["0,0", "0,1", "1,0", "1,1", "e0.0", "e0.1"]);
    const a = boxes.find((b) => b.target.kind === "key" && b.target.row === 0 && b.target.col === 0)!.box;
    expect(a.cx).toBeCloseTo(0.5);
    expect(a.cy).toBeCloseTo(0.5);
  });

  it("picks what a dragged box touches", async () => {
    const kb = await board();
    // From the middle of 0,0 to the middle of 1,1: all four keys, not the encoder.
    expect(names(targetsInBox(keyBoxes(kb), 0.5, 0.5, 1.5, 1.5))).toEqual(["0,0", "0,1", "1,0", "1,1"]);
    // A thin box along the top row, dragged right to left.
    expect(names(targetsInBox(keyBoxes(kb), 1.6, 0.4, 0.4, 0.6))).toEqual(["0,0", "0,1"]);
  });

  it("selects the block between two keys", async () => {
    const kb = await board();
    expect(names(keysBetween(kb, key(0, 0), key(1, 1)))).toEqual(["0,0", "0,1", "1,0", "1,1"]);
    expect(names(keysBetween(kb, key(0, 1), key(0, 0)))).toEqual(["0,0", "0,1"]);
  });
});

describe("pasting keys", () => {
  it("puts one copied key on every selected key", async () => {
    const kb = await board();
    const plan = planKeyPaste(kb, [{ code: A, from: key(0, 0) }], [key(1, 0), key(1, 1)]);
    expect(plan).toEqual({
      writes: [
        { target: key(1, 0), code: A },
        { target: key(1, 1), code: A },
      ],
      missed: 0,
    });
  });

  it("pairs as many copied keys as selected keys in reading order", async () => {
    const kb = await board();
    // Copied and selected in different click orders: still top-left first.
    const copied = [
      { code: B, from: key(0, 1) },
      { code: A, from: key(0, 0) },
    ];
    const plan = planKeyPaste(kb, copied, [key(1, 1), key(1, 0)]);
    expect(plan).toEqual({
      writes: [
        { target: key(1, 0), code: A },
        { target: key(1, 1), code: B },
      ],
      missed: 0,
    });
  });

  it("keeps the copied shape when pasting onto one key, leaving out keys with nowhere to land", async () => {
    const kb = await board();
    const row = [
      { code: A, from: key(0, 0) },
      { code: B, from: key(0, 1) },
    ];
    expect(planKeyPaste(kb, row, [key(1, 0)])).toEqual({
      writes: [
        { target: key(1, 0), code: A },
        { target: key(1, 1), code: B },
      ],
      missed: 0,
    });
    // From 1,1 the second key would land right of the board's keys.
    expect(planKeyPaste(kb, row, [key(1, 1)])).toEqual({
      writes: [{ target: key(1, 1), code: A }],
      missed: 1,
    });
  });

  it("continues text in reading order from the selected key", async () => {
    const kb = await board();
    const plan = planKeyPaste(kb, [{ code: A }, { code: B }, { code: C }], [key(0, 1)]);
    expect(plan).toEqual({
      writes: [
        { target: key(0, 1), code: A },
        { target: key(1, 0), code: B },
        { target: key(1, 1), code: C },
      ],
      missed: 0,
    });
  });

  it("explains a count it can't pair", async () => {
    const kb = await board();
    const copied = [0, 1, 2].map((col) => ({ code: A, from: key(0, col % 2) }));
    const plan = planKeyPaste(kb, copied, [key(0, 0), key(1, 1)]);
    expect(plan).toEqual({
      error: "3 keys are copied: select one key to paste them from there, or 3 keys to paste them onto.",
    });
    expect(planKeyPaste(kb, [], [key(0, 0)])).toHaveProperty("error");
    expect(planKeyPaste(kb, [{ code: A }], [])).toHaveProperty("error");
  });
});

describe("keys as text", () => {
  it("writes QMK names and reads them back, brackets and all", async () => {
    const kb = await board();
    const t = kb.keycodes;
    const codes = [A, t.parse("LT(1, KC_SPC)"), t.parse("LCTL(KC_C)")];
    const text = keysText(t, codes);
    expect(text).toBe("KC_A LT1(KC_SPACE) LCTL(KC_C)");
    expect(parseKeysText(t, text)).toEqual(codes);
    expect(parseKeysText(t, "  KC_A\nLT(1, KC_SPC)  ")).toEqual(codes.slice(0, 2));
  });

  it("refuses text that isn't keys", async () => {
    const kb = await board();
    expect(parseKeysText(kb.keycodes, "hello there")).toBeNull();
    expect(parseKeysText(kb.keycodes, "12 14")).toBeNull();
    expect(parseKeysText(kb.keycodes, "LT(1, KC_SPC")).toBeNull();
    expect(parseKeysText(kb.keycodes, "")).toBeNull();
  });
});
