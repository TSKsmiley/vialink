// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_EXTENSIONS } from "./extensions/index.ts";
import type { HostContext, KeyboardExtension } from "./extensions/types.ts";
import { Keyboard } from "./keyboard.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";
import { applyVilRestore, parseVil, saveVil } from "./vil.ts";
import { leftOutOfVil, planLayoutRestore, readLayoutFile, saveVialink, VIALINK_FORMAT } from "./vialink.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);
const BIG_UID = 18364758544493064720n; // above 2^53: must survive JSON

let notesCtx: HostContext | null = null;
const notes: KeyboardExtension<unknown> = {
  id: "key-notes",
  name: "Key notes",
  description: "",
  group: "compatible",
  probe: async (ctx) => ((notesCtx = ctx), {}),
};

async function board(extensions: KeyboardExtension<unknown>[] = [...BUILTIN_EXTENSIONS, notes]) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    uid: BIG_UID,
    layerNames: ["Base", "Nav"],
  });
  await sim.open();
  sim.unlocked = true;
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions });
  return { sim, kb };
}

const read = (text: string) => {
  const r = readLayoutFile(text);
  if (r.kind !== "vialink") throw new Error("expected .vialink");
  return r.file;
};

describe(".vialink layout files", () => {
  it("hold exactly the .vil export in `vil`, with the uid intact", async () => {
    const { kb } = await board();
    const text = saveVialink(kb, { app: "0.1.0" });
    const file = read(text);
    expect(file.vialink).toBe(VIALINK_FORMAT);
    expect(file.manifest).toMatchObject({ app: "0.1.0", extensions: { "layer-names": 1 } });
    expect(text).toContain(`"uid": ${BIG_UID}`);
    const fromFile = parseVil(JSON.stringify(file.vil).replace(/"uid":"(\d+)"/, '"uid":$1'));
    const exported = parseVil(saveVil(kb));
    expect(fromFile.uid).toBe(BIG_UID);
    expect(fromFile.raw).toEqual({ ...exported.raw });
  });

  it("load back with nothing to write, and tell plain .vil apart", async () => {
    const { kb } = await board();
    const plan = planLayoutRestore(kb, read(saveVialink(kb, { app: "t" })), BUILTIN_EXTENSIONS);
    expect(plan.ops).toEqual([]);
    expect(plan.uidMismatch).toBe(false);
    expect(readLayoutFile(saveVil(kb)).kind).toBe("vil");
  });

  it("refuse a newer format and say why", () => {
    expect(() => readLayoutFile('{"vialink": 2, "vil": {}}')).toThrow(
      "This .vialink file is format 2; this ViaLink reads up to format 1. Update ViaLink to load it.",
    );
    expect(() => readLayoutFile("not json")).toThrow("isn't JSON");
  });

  it("save and load extensions' layout state, undoably", async () => {
    const { kb } = await board();
    notesCtx!.state("labels", { default: {} as Record<string, string> }).set({ M3: "Email signature" });
    const file = read(saveVialink(kb, { app: "t" }));
    expect(file.extensions["key-notes"]).toEqual({
      v: 1,
      state: { labels: { v: 1, value: { M3: "Email signature" } } },
    });

    notesCtx!.state("labels", { default: {} as Record<string, string> }).set({});
    const plan = planLayoutRestore(kb, file, BUILTIN_EXTENSIONS);
    expect(plan.ops.map((op) => (op.kind === "extension" ? op.description : op.kind))).toEqual([
      "Load Key notes's saved data",
    ]);
    await applyVilRestore(kb, plan, undefined, "Load test.vialink");
    expect(notesCtx!.state("labels", { default: {} }).get()).toEqual({ M3: "Email signature" });
    await kb.history.undo();
    expect(notesCtx!.state("labels", { default: {} }).get()).toEqual({});
    expect(leftOutOfVil(kb)).toEqual(["Layer names", "Key notes"]);
  });

  it("keep sections of extensions that are off or unknown for the next save", async () => {
    const { kb } = await board();
    const file = read(saveVialink(kb, { app: "t" }));
    file.extensions["macro-recorder"] = { v: 3, recordings: [1, 2] };
    const off = await board(BUILTIN_EXTENSIONS.filter((e) => e.id !== "layer-names"));
    const plan = planLayoutRestore(off.kb, file, BUILTIN_EXTENSIONS);
    expect(plan.notes).toEqual([
      "Turn on Layer names to load its data; it is kept for the next save.",
      "Data from an extension this ViaLink doesn't know (macro-recorder) is kept for the next save.",
    ]);
    await applyVilRestore(off.kb, plan);
    plan.afterApply();
    const again = read(saveVialink(off.kb, { app: "t" }));
    expect(again.extensions).toEqual({
      "layer-names": { v: 1, names: ["Base", "Nav"] },
      "macro-recorder": { v: 3, recordings: [1, 2] },
    });
  });
});
