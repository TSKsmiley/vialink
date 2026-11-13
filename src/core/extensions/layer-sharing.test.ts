// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import { decodeLayer, encodeLayer } from "../layer-share.ts";
import { planPaste, snapshotLayer } from "../layers.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { OperationVetoedError, on } from "./hooks.ts";
import { BUILTIN_EXTENSIONS } from "./index.ts";
import { paste, pasteLayer, shareData, shareText } from "./layer-sharing.ts";
import { layerNamesExtension } from "./layerNames.ts";
import type { KeyboardExtension } from "./types.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

async function board(extra: KeyboardExtension<unknown>[] = []) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 3,
    encoderCount: 1,
    layerNames: ["Base", "Nav", ""],
  });
  await sim.open();
  sim.unlocked = true;
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: [...BUILTIN_EXTENSIONS, ...extra],
  });
  await kb.setKey(1, 0, 0, 0x04);
  kb.history.clear();
  return { kb, names: kb.extension(layerNamesExtension)! };
}

const pasteNav = (kb: Keyboard, ext: Record<string, unknown>, name: string | null) =>
  pasteLayer(
    kb,
    { source: "copy", target: 2, mode: "replace", name, ext },
    planPaste(kb, snapshotLayer(kb, 1), 2, "replace", true).writes,
    "Paste Nav onto layer 2",
  );

describe("layer sharing hook points", () => {
  it("carry the layer name in share data and share text", async () => {
    const { kb } = await board();
    const ext = await shareData(kb, 1);
    expect(ext).toEqual({ "layer-names": { name: "Nav" } });
    const shared = await decodeLayer(await encodeLayer(kb, 1, ext));
    expect(shared.ext).toEqual({ "layer-names": { name: "Nav" } });
    expect(await shareData(kb, 2)).toEqual({}); // an unnamed layer adds nothing
  });

  it("name the target in the paste's undo step when the user chose a name and it has none", async () => {
    const { kb, names } = await board();
    await pasteNav(kb, {}, "Nav (imported)");
    expect(kb.getKey(2, 0, 0)).toBe(0x04);
    expect(names.get(2)).toBe("Nav (imported)");
    await kb.history.undo();
    expect(names.get(2)).toBe("");

    await pasteNav(kb, {}, null); // checkbox off
    expect(names.get(2)).toBe("");
  });

  it("let other extensions veto a paste and skip a failing share handler", async () => {
    const guard: KeyboardExtension<unknown> = {
      id: "guard",
      name: "Guard",
      description: "",
      group: "compatible",
      optional: ["layer-sharing"],
      hooks: [
        on(paste.before, (e) => {
          if (e.target === 2) e.preventDefault("layer 2 is locked");
        }),
        on(shareText.after, () => {
          throw new Error("no data today");
        }),
      ],
      probe: async () => ({}),
    };
    const { kb } = await board([guard]);
    await expect(pasteNav(kb, {}, null)).rejects.toThrow(OperationVetoedError);
    expect(kb.getKey(2, 0, 0)).not.toBe(0x04);

    const errors: string[] = [];
    kb.notifyHandler = (kind, message) => errors.push(`${kind}: ${message}`);
    expect(await shareData(kb, 1)).toEqual({ "layer-names": { name: "Nav" } });
    expect(errors).toEqual(["error: Guard: no data today"]);
  });
});
