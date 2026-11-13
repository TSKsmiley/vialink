// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { memoryStorage, type BrowserStorage } from "./state.ts";
import type { HostContext, KeyboardExtension } from "./types.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

/** Loads a board with two compatible extensions and hands back their contexts. */
async function setup(browserStorage: BrowserStorage = memoryStorage()) {
  const contexts: Record<string, HostContext> = {};
  const make = (id: string, name: string): KeyboardExtension<unknown> => ({
    id,
    name,
    description: "",
    group: "compatible",
    async probe(ctx) {
      contexts[id] = ctx;
      return {};
    },
  });
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: [make("notes", "Key notes"), make("tour", "Tour")],
    browserStorage,
  });
  return { kb, notes: contexts.notes, tour: contexts.tour };
}

describe("ctx.state", () => {
  it("keeps layout state, re-renders, and undoes changes", async () => {
    const { kb, notes } = await setup();
    const labels = notes.state<Record<string, string>>("labels", { default: {} });
    expect(labels.get()).toEqual({});
    const before = kb.version;
    labels.set({ M3: "Email signature" });
    expect(kb.version).toBeGreaterThan(before);
    expect(notes.state("labels", { default: {} })).toBe(labels); // one handle per name
    expect(kb.history.nextUndo?.label).toBe("Key notes: change labels");
    expect(kb.extensionLayoutState()).toEqual({
      notes: { labels: { v: 1, value: { M3: "Email signature" } } },
    });

    await kb.history.undo();
    expect(labels.get()).toEqual({});
    await kb.history.redo();
    expect(labels.get()).toEqual({ M3: "Email signature" });
  });

  it("keeps browser state in browser storage, not in the layout or undo", async () => {
    const storage = memoryStorage();
    const first = await setup(storage);
    first.tour.state("seen", { persist: "browser", default: [] as string[] }).set(["keymap"]);
    expect(first.kb.history.canUndo).toBe(false);
    expect(first.kb.extensionLayoutState()).toEqual({});
    expect(storage.get("vialink.ext.tour.seen")).toBe('{"v":1,"value":["keymap"]}');

    // Another connection in the same browser finds it again.
    const second = await setup(storage);
    expect(second.tour.state("seen", { persist: "browser", default: [] }).get()).toEqual(["keymap"]);
  });

  it("upgrades older saved shapes and ignores newer or broken ones", async () => {
    const storage = memoryStorage();
    storage.set("vialink.ext.tour.old", '{"v":1,"value":"keymap"}');
    storage.set("vialink.ext.tour.future", '{"v":9,"value":"?"}');
    storage.set("vialink.ext.tour.broken", "{nope");
    const { tour } = await setup(storage);
    const upgraded = tour.state<string[]>("old", {
      persist: "browser",
      default: [],
      version: 2,
      upgrade: (old, from) => (from === 1 && typeof old === "string" ? [old] : []),
    });
    expect(upgraded.get()).toEqual(["keymap"]);
    expect(tour.state("future", { persist: "browser", default: "default", version: 2 }).get()).toBe(
      "default",
    );
    expect(tour.state("broken", { persist: "browser", default: 0 }).get()).toBe(0);
    // Without an upgrade, an older shape falls back to the default.
    storage.set("vialink.ext.tour.plain", '{"v":1,"value":1}');
    expect(tour.state("plain", { persist: "browser", default: 5, version: 2 }).get()).toBe(5);
  });

  it("keeps each extension's state to itself", async () => {
    const { notes, tour } = await setup();
    notes.state("shared-name", { default: 0 }).set(1);
    expect(tour.state("shared-name", { default: 0 }).get()).toBe(0);
  });
});
