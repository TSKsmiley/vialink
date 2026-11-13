// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RollbackError } from "../history.ts";
import { Keyboard } from "../keyboard.ts";
import { KC_TRNS } from "../layerInfo.ts";
import { clearLayer, layerClear, layerSwap, swapLayers } from "../layers.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import {
  HookPhaseError,
  OperationCancelledError,
  OperationVetoedError,
  on,
  type HookHandler,
} from "./hooks.ts";
import { layerNamesExtension } from "./layerNames.ts";
import type { KeyboardExtension } from "./types.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

const fake = (id: string, hooks: HookHandler[]): KeyboardExtension<unknown> => ({
  id,
  name: id,
  description: "",
  group: "compatible",
  hooks,
  probe: async () => ({ id }),
});

async function board(extensions: KeyboardExtension<unknown>[], layerNames: string[] | null = null) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    layerNames,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions });
  sim.unlocked = true;
  await kb.setKey(1, 0, 0, 0x04); // KC_A on layer 1
  kb.history.clear();
  return kb;
}

describe("operations with hook points", () => {
  it("collects every veto, writes nothing, and names each extension", async () => {
    const kb = await board([
      fake("A", [on(layerClear.before, (e) => e.preventDefault(`layer ${e.layer} is pinned`))]),
      fake("B", [on(layerClear.before, (e) => e.preventDefault("busy"))]),
    ]);
    const err = await clearLayer(kb, 1, "Clear").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OperationVetoedError);
    expect((err as OperationVetoedError).reasons).toEqual(["A: layer 1 is pinned", "B: busy"]);
    expect(kb.getKey(1, 0, 0)).toBe(0x04);
    expect(kb.history.canUndo).toBe(false);
  });

  it("asks all questions at once and stops when the user says no", async () => {
    const kb = await board([
      fake("A", [on(layerClear.before, (e) => e.requireConfirm("Clear the base layer?"))]),
      fake("B", [on(layerClear.before, (e) => e.requireConfirm("Also forget notes?"))]),
    ]);
    const asked: (readonly string[])[] = [];
    kb.confirmHandler = async (messages) => (asked.push(messages), false);
    await expect(clearLayer(kb, 1, "Clear")).rejects.toBeInstanceOf(OperationCancelledError);
    expect(asked).toEqual([["Clear the base layer?", "Also forget notes?"]]);
    expect(kb.getKey(1, 0, 0)).toBe(0x04);

    kb.confirmHandler = async () => true;
    await clearLayer(kb, 1, "Clear");
    expect(kb.getKey(1, 0, 0)).toBe(KC_TRNS);
  });

  it("refuses writes from before and filter handlers", async () => {
    const kb = await board([
      fake("Sneaky", [
        on(layerClear.before, async (e, ctx) => {
          await ctx.keymap.set(e.layer, 0, 1, 0x05);
        }),
      ]),
    ]);
    await expect(clearLayer(kb, 1, "Clear")).rejects.toBeInstanceOf(HookPhaseError);
    const kb2 = await board([
      fake("Sneaky", [
        on(layerClear.filter, (plan, _e, ctx) => {
          ctx.state("x", { default: 0 }).set(1);
          return plan;
        }),
      ]),
    ]);
    await expect(clearLayer(kb2, 1, "Clear")).rejects.toThrow(
      'Sneaky tried to change its state "x" while checking an operation',
    );
  });

  it("lets filters adjust the plan and warn", async () => {
    const kb = await board([
      fake("Keeper", [
        on(layerClear.filter, (plan) => ({
          plan: plan.filter((w) => !(w.kind === "key" && w.row === 0 && w.col === 0)),
          warnings: ["kept key (0, 0)"],
        })),
      ]),
    ]);
    const notices: string[] = [];
    kb.notifyHandler = (_kind, message) => notices.push(message);
    await kb.setKey(1, 1, 1, 0x06);
    await clearLayer(kb, 1, "Clear");
    expect(kb.getKey(1, 0, 0)).toBe(0x04);
    expect(kb.getKey(1, 1, 1)).toBe(KC_TRNS);
    expect(notices).toEqual(["Keeper: kept key (0, 0)"]);
  });

  it("rolls the whole operation back when an after handler fails", async () => {
    const kb = await board([
      fake("Flaky", [
        on(layerClear.after, () => {
          throw new Error("disk full");
        }),
      ]),
    ]);
    await expect(clearLayer(kb, 1, "Clear")).rejects.toThrow("Flaky failed: disk full");
    expect(kb.getKey(1, 0, 0)).toBe(0x04);
    expect(kb.history.canUndo).toBe(false);
  });

  it("keeps a half-done operation undoable when putting it back fails", async () => {
    const kb = await board([
      fake("Broken", [
        on(layerClear.after, async (_e, ctx) => {
          ctx.history.record({
            label: "broken write",
            undo: async () => {
              throw new Error("keyboard gone");
            },
            redo: async () => undefined,
          });
          throw new Error("disk full");
        }),
      ]),
    ]);
    const err = await clearLayer(kb, 1, "Clear").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RollbackError);
    expect((err as Error).message).toBe(
      "Broken failed: disk full; putting it back also failed: keyboard gone. Undo can try again.",
    );
    expect(kb.history.nextUndo?.label).toBe("Clear");
  });

  it("moves layer names with a swap, as one undo step, and undo doesn't run hooks again", async () => {
    let afterRuns = 0;
    const counter = fake("counter", [on(layerSwap.after, () => void afterRuns++)]);
    const kb = await board([layerNamesExtension as KeyboardExtension<unknown>, counter], ["Base", "Nav"]);
    const names = kb.extension(layerNamesExtension)!;
    await swapLayers(kb, 0, 1, "Swap");
    expect([names.get(0), names.get(1)]).toEqual(["Nav", "Base"]);
    expect(kb.getKey(0, 0, 0)).toBe(0x04);
    expect(afterRuns).toBe(1);

    await kb.history.undo();
    expect([names.get(0), names.get(1)]).toEqual(["Base", "Nav"]);
    expect(kb.getKey(1, 0, 0)).toBe(0x04);
    expect(afterRuns).toBe(1);
    expect(kb.history.canUndo).toBe(false);
  });
});
