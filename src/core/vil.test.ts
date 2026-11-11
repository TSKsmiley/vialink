// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";
import { applyVilRestore, parseVil, planVilRestore, pythonJson, saveVil } from "./vil.ts";

const read = (path: string) => readFileSync(new URL(`../../fixtures/${path}`, import.meta.url));

async function board(uid = 0xfedcba9876543210n) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(read("definitions/test_2x2_encoder.vial.json.xz")),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    uid,
    unlocked: true,
    macroCount: 2,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb };
}

describe(".vil files", () => {
  it("loads a vial-gui file, writes it to the board and saves it back in vial-gui's format", async () => {
    const { sim, kb } = await board();
    const text = read("vil/test_2x2_encoder.vil").toString("utf-8").trim();
    const plan = planVilRestore(kb, parseVil(text));

    expect(plan.uidMismatch).toBe(false);
    expect(plan.skippedFeatures).toEqual(["macros"]);
    expect(plan.unknownKeycodes).toEqual([]);

    await applyVilRestore(kb, plan);
    expect(sim.getKeycode(0, 0, 1)).toBe(0x0205); // LSFT(KC_B)
    expect(sim.getKeycode(0, 1, 0)).toBe(0x412c); // LT1(KC_SPC)
    expect(sim.getKeycode(1, 1, 0)).toBe(0x7c00); // QK_BOOT, board is unlocked
    expect(sim.getEncoder(0, 0, 1)).toBe(0x00a9); // KC_VOLU
    expect(sim.layoutOptions).toBe(1);

    // Keymap fields come back identical; unread features (macro etc.) are omitted,
    // and "0x7e05" normalizes to its name, as vial-gui's serialize() does.
    const expected =
      '{"version": 1, "uid": 18364758544493064720, ' +
      '"layout": [[["KC_A", "LSFT(KC_B)"], ["LT1(KC_SPACE)", "MO(1)"]], [["KC_TRNS", "KC_NO"], ["QK_BOOT", "USER05"]]], ' +
      '"encoder_layout": [[["KC_VOLD", "KC_VOLU"]], [["KC_TRNS", "KC_TRNS"]]], ' +
      '"layout_options": 1, "vial_protocol": 6, "via_protocol": 9}';
    expect(saveVil(kb)).toBe(expected);

    // Loading the saved file again is a no-op.
    expect(planVilRestore(kb, parseVil(saveVil(kb))).ops).toEqual([]);
  });

  it("flags a UID mismatch and skips entries the board lacks", async () => {
    const { kb } = await board(0x1n);
    const file = parseVil(
      pythonJson({
        version: 1,
        uid: 99n,
        layout: [[["KC_A", -1]], [["KC_B", -1]], [["KC_C", -1]]],
        encoder_layout: [],
        layout_options: -1,
      }),
    );
    const plan = planVilRestore(kb, file);
    expect(plan.uidMismatch).toBe(true);
    expect(plan.ignoredEntries).toBe(1); // layer 2 does not exist
    expect(plan.ops).toHaveLength(2);
  });

  it("accepts legacy integer keycodes and reports unparseable ones", async () => {
    const { kb } = await board();
    const plan = planVilRestore(
      kb,
      parseVil(
        '{"uid": 1, "layout": [[[4, "KC_BOGUS"], [-1, -1]]], "encoder_layout": [], "layout_options": -1}',
      ),
    );
    expect(plan.ops).toEqual([{ kind: "key", layer: 0, row: 0, col: 0, code: 4 }]);
    expect(plan.unknownKeycodes).toEqual(["KC_BOGUS"]);
  });

  it("writes JSON like Python's json.dumps", () => {
    expect(pythonJson({ a: [1, "é"], b: 2n ** 63n })).toBe('{"a": [1, "\\u00e9"], "b": 9223372036854775808}');
  });

  it("rejects files without a layout", () => {
    expect(() => parseVil("{}")).toThrow(/layout/);
    expect(() => parseVil("not json")).toThrow(/malformed JSON/);
  });
});
