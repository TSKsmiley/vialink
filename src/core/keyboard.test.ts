// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layerNamesExtension } from "./extensions/layerNames.ts";
import { Keyboard, UnlockRequiredError } from "./keyboard.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";
import { ReplayTransport } from "./transport/replay.ts";
import { parseVil, planVilRestore, saveVil } from "./vil.ts";

const klorXz = new Uint8Array(
  readFileSync(new URL("../../fixtures/definitions/klor.vial.json.xz", import.meta.url)),
);

function klor() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: klorXz,
    rows: 8,
    cols: 6,
    layers: 4,
    macroCount: 4,
    dynamic: { tapDance: 2, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0b11 },
    layerNames: ["Base", "Nav", "", ""],
  });
  return sim;
}

describe("Keyboard against a simulated KLOR", () => {
  it("loads, edits, and replays the recorded session", async () => {
    const sim = klor();
    await sim.open();
    const queue = new RequestQueue(sim, { retryDelayMs: 0 });
    const kb = await Keyboard.load(queue);

    expect(kb.vialProtocol).toBe(6);
    expect(kb.layers).toBe(4);
    expect(kb.keys.length).toBeGreaterThan(30);
    const { row, col } = kb.keys[0];
    expect(kb.getKey(0, row, col)).toBe(0);
    expect(kb.extension(layerNamesExtension)?.names.slice(0, 2)).toEqual(["Base", "Nav"]);
    expect(kb.keycodes.find("USER00")?.label).toBe("ACTION");

    await kb.setKey(1, row, col, 0x0204);
    expect(sim.getKeycode(1, row, col)).toBe(0x0204);
    await expect(kb.setKey(0, row, col, 0x7c00)).rejects.toBeInstanceOf(UnlockRequiredError);

    // The exported trace replays strictly through a fresh load.
    const trace = queue.exportTrace();
    const replay = new ReplayTransport(trace);
    await replay.open();
    const again = await Keyboard.load(new RequestQueue(replay, { retryDelayMs: 0 }));
    expect(again.getKey(1, row, col)).toBe(0); // the trace holds the keymap as read before the edit

    // .vil save → parse → plan against the same board is a no-op.
    const vil = saveVil(kb);
    expect(vil.startsWith('{"version": 1, "uid": ')).toBe(true);
    expect(planVilRestore(kb, parseVil(vil)).ops).toEqual([]);
  });

  it("retries a dropped reply", async () => {
    const sim = klor();
    await sim.open();
    sim.dropNext = 2;
    const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
    expect(kb.layers).toBe(4);
  });
});
