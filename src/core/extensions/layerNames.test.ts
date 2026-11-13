// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import { layerNameBytes, normalizeLayerName, vialSetLayerName } from "../protocol/commands.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { toHex } from "../util/bytes.ts";
import { parseVil, planVilRestore, saveVil } from "../vil.ts";
import { planLayoutRestore, readLayoutFile, saveVialink } from "../vialink.ts";
import { KC_TRNS } from "../layerInfo.ts";
import { clearLayer } from "../layers.ts";
import { layerNamesExtension } from "./layerNames.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

async function board(opts: { layerNames?: string[] | null; extensions?: [] } = {}) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    layerNames: opts.layerNames === undefined ? ["Base", "Nav"] : opts.layerNames,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: opts.extensions,
  });
  return { sim, kb };
}

describe("layer names extension", () => {
  it("encodes the set command and truncates at a character boundary", () => {
    expect(toHex(vialSetLayerName.encode(1, "Nav"))).toBe("fe0d0a01" + "4e6176" + "00".repeat(13));
    // 15 ASCII bytes + a 2-byte "é" would be 17 bytes: the "é" is dropped, not split.
    expect(normalizeLayerName("abcdefghijklmnoé")).toBe("abcdefghijklmno");
    expect(layerNameBytes("abcdefghijklmnoé")[15]).toBe(0);
  });

  it("is active on boards that answer the get, and inactive on stock Vial", async () => {
    expect((await board()).kb.extension(layerNamesExtension)?.names).toEqual(["Base", "Nav"]);
    const stock = await board({ layerNames: null });
    expect(stock.kb.extension(layerNamesExtension)).toBeNull();
    // Only the device-free layer sharing extra is active on stock Vial here.
    expect(stock.kb.activeExtensions.map((a) => a.extension.id)).toEqual(["layer-sharing"]);
  });

  it("can be turned off", async () => {
    const { kb } = await board({ extensions: [] });
    expect(kb.extension(layerNamesExtension)).toBeNull();
    expect(saveVil(kb)).not.toContain("layer_names");
  });

  it("hooks into Clear layer: the name goes with the keys, in one undo step", async () => {
    const { sim, kb } = await board();
    sim.unlocked = true;
    const names = kb.extension(layerNamesExtension)!;
    await kb.setKey(1, 0, 0, 0x04);
    await clearLayer(kb, 1, "Clear Nav");
    expect(sim.layerNames).toEqual(["Base", ""]);
    expect(kb.getKey(1, 0, 0)).toBe(KC_TRNS);
    expect(kb.history.nextUndo?.label).toBe("Clear Nav");

    await kb.history.undo();
    expect(sim.layerNames).toEqual(["Base", "Nav"]);
    expect(names.get(1)).toBe("Nav");
    expect(kb.getKey(1, 0, 0)).toBe(0x04);
  });

  it("asks for an unlock before renaming, and verifies the write", async () => {
    const { sim, kb } = await board();
    const names = kb.extension(layerNamesExtension)!;
    await expect(names.set(1, "Lower")).rejects.toBeInstanceOf(UnlockRequiredError);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    await names.set(1, "Lower");
    expect(asked).toBe("Renaming a layer");
    expect(sim.layerNames).toEqual(["Base", "Lower"]);
    expect(names.get(1)).toBe("Lower");
  });

  it("keeps names in its .vialink section and out of .vil", async () => {
    const { sim, kb } = await board();
    expect(saveVil(kb)).not.toContain("layer_names"); // Export to Vial stays pure Vial
    const text = saveVialink(kb, { app: "test" });
    const read = readLayoutFile(text.replace('"Nav"', '"Symbols"'));
    if (read.kind !== "vialink") throw new Error("expected a .vialink file");
    expect(read.file.extensions["layer-names"]).toEqual({ v: 1, names: ["Base", "Symbols"] });
    const plan = planLayoutRestore(kb, read.file, [layerNamesExtension]);
    expect(plan.ops.map((op) => (op.kind === "extension" ? op.description : op.kind))).toEqual([
      'Rename layer 1 to "Symbols"',
    ]);
    sim.unlocked = true;
    for (const op of plan.ops) if (op.kind === "extension") await op.apply();
    expect(sim.layerNames).toEqual(["Base", "Symbols"]);
  });

  it("ignores the Theis194 fork's layer_names on Import from Vial", async () => {
    const { kb } = await board();
    const plan = planVilRestore(
      kb,
      parseVil('{"uid": 1, "layout": [], "layout_options": -1, "layer_names": ["A", "B"]}'),
    );
    expect(plan.ops).toEqual([]);
    expect(plan.skippedFeatures).toEqual(["layer names"]);
  });

  it("reports names in a file as skipped when the board lacks the extension", async () => {
    const { kb } = await board({ layerNames: null });
    const plan = planVilRestore(
      kb,
      parseVil('{"uid": 1, "layout": [], "layout_options": -1, "layer_names": ["A", "B"]}'),
    );
    expect(plan.skippedFeatures).toEqual(["layer names"]);
  });
});
