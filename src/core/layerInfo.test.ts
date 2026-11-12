// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import { keyCount, layerKeyOf, reachSummary, reachesOf, visiblePositions } from "./layerInfo.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";

async function klor() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    keymap: [[[0x00, 0x04, 0x05]]],
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
}

describe("layer info", () => {
  it("recognises layer keycodes", async () => {
    const kb = await klor();
    const t = kb.keycodes;
    expect(layerKeyOf(t, 4, t.parse("MO(2)"))).toEqual({ action: "MO", layer: 2 });
    expect(layerKeyOf(t, 4, t.parse("LT(1, KC_SPACE)"))).toEqual({ action: "LT", layer: 1, tap: 0x2c });
    expect(layerKeyOf(t, 4, t.parse("TG(3)"))).toEqual({ action: "TG", layer: 3 });
    expect(layerKeyOf(t, 4, t.parse("KC_A"))).toBeNull();
    expect(layerKeyOf(t, 4, t.parse("LCTL(KC_A)"))).toBeNull();
  });

  it("counts set keys and says how each layer is reached", async () => {
    const kb = await klor();
    const [a, b] = visiblePositions(kb);
    expect(keyCount(kb, 1)).toBe(0); // the simulator fills higher layers with KC_NO
    await kb.setKey(0, a.row, a.col, kb.keycodes.parse("LT(1, KC_SPACE)"));
    await kb.setKey(0, b.row, b.col, kb.keycodes.parse("MO(2)"));
    await kb.setKey(1, a.row, a.col, kb.keycodes.parse("KC_TRNS"));
    await kb.setKey(1, b.row, b.col, kb.keycodes.parse("KC_UP"));

    expect(keyCount(kb, 1)).toBe(1); // transparent keys do not count
    expect(reachSummary(kb, 0)).toBe("default");
    expect(reachSummary(kb, 1)).toBe("hold Space");
    expect(reachSummary(kb, 2)).toBe("hold key");
    expect(reachSummary(kb, 3)).toBe("not reached");
    expect(reachesOf(kb, 2)).toEqual([{ from: 0, row: b.row, col: b.col, key: { action: "MO", layer: 2 } }]);
  });
});
