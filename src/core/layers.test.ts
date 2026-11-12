// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import { KC_NO, KC_TRNS, visiblePositions } from "./layerInfo.ts";
import {
  applyLayerWrites,
  firstEmptyLayer,
  planClear,
  planPaste,
  snapshotCounts,
  snapshotLayer,
  swapLayers,
} from "./layers.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";

const A = 0x04;
const B = 0x05;
const C = 0x06;

async function board() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 3,
    encoderCount: 1,
    keymap: [[[A, B]]],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const [p, q, r, s] = visiblePositions(kb);
  return { sim, kb, p, q, r, s };
}

/** Layer 1 = [A, TRNS, TRNS, C], layer 2 = [B, B, NO, NO]. */
async function twoLayers() {
  const env = await board();
  const { kb, p, q, r, s } = env;
  const set = (l: number, pos: { row: number; col: number }, c: number) => kb.setKey(l, pos.row, pos.col, c);
  await set(1, p, A);
  await set(1, q, KC_TRNS);
  await set(1, r, KC_TRNS);
  await set(1, s, C);
  await set(2, p, B);
  await set(2, q, B);
  await set(2, r, KC_NO);
  await set(2, s, KC_NO);
  kb.history.clear();
  return env;
}

describe("layer paste", () => {
  it("replace: the target becomes an exact copy, transparent keys included", async () => {
    const { kb, p, q, r, s } = await twoLayers();
    const plan = planPaste(kb, snapshotLayer(kb, 1), 2, "replace", false);
    const to = new Map(plan.writes.map((w) => [w.kind === "key" ? `${w.row},${w.col}` : "", w.to]));
    expect(to.get(`${p.row},${p.col}`)).toBe(A);
    expect(to.get(`${q.row},${q.col}`)).toBe(KC_TRNS);
    expect(to.get(`${r.row},${r.col}`)).toBe(KC_TRNS);
    expect(to.get(`${s.row},${s.col}`)).toBe(C);
  });

  it("overlay: only where the source has a key", async () => {
    const { kb, p, q, s } = await twoLayers();
    const plan = planPaste(kb, snapshotLayer(kb, 1), 2, "overlay", false);
    const keys = plan.writes.map((w) => (w.kind === "key" ? `${w.row},${w.col}` : ""));
    expect(keys).toContain(`${p.row},${p.col}`);
    expect(keys).toContain(`${s.row},${s.col}`);
    expect(keys).not.toContain(`${q.row},${q.col}`); // transparent on the source: B stays
  });

  it("fill: only the target's empty keys", async () => {
    const { kb, s } = await twoLayers();
    const plan = planPaste(kb, snapshotLayer(kb, 1), 2, "fill", false);
    expect(plan.writes).toEqual([{ kind: "key", row: s.row, col: s.col, from: KC_NO, to: C }]);
  });

  it("leaves keys that would reach their own layer, and reports them", async () => {
    const { kb, p } = await twoLayers();
    await kb.setKey(1, p.row, p.col, kb.keycodes.parse("MO(2)"));
    const plan = planPaste(kb, snapshotLayer(kb, 1), 2, "overlay", false);
    expect(plan.selfReferences).toEqual([{ row: p.row, col: p.col, code: kb.keycodes.parse("MO(2)") }]);
    expect(plan.writes.some((w) => w.kind === "key" && w.row === p.row && w.col === p.col)).toBe(false);
  });

  it("includes encoders only when asked", async () => {
    const { kb } = await twoLayers();
    await kb.setEncoder(1, 0, 0, A);
    expect(
      planPaste(kb, snapshotLayer(kb, 1), 2, "overlay", false).writes.some((w) => w.kind === "encoder"),
    ).toBe(false);
    expect(
      planPaste(kb, snapshotLayer(kb, 1), 2, "overlay", true).writes.some((w) => w.kind === "encoder"),
    ).toBe(true);
  });

  it("applies as one undo step", async () => {
    const { kb, sim, p, s } = await twoLayers();
    const plan = planPaste(kb, snapshotLayer(kb, 1), 2, "replace", true);
    await applyLayerWrites(kb, 2, plan.writes, "Paste layer 1 onto layer 2");
    expect(sim.getKeycode(2, s.row, s.col)).toBe(C);
    expect(kb.history.nextUndo?.writes.length).toBe(plan.writes.length);
    await kb.history.undo();
    expect(sim.getKeycode(2, p.row, p.col)).toBe(B);
    expect(sim.getKeycode(2, s.row, s.col)).toBe(KC_NO);
  });

  it("pastes some keys only when the snapshot holds some keys", async () => {
    const { kb, p, s } = await twoLayers();
    const some = snapshotLayer(kb, 1, [{ kind: "key", row: s.row, col: s.col }]);
    expect(snapshotCounts(some)).toEqual({ keys: 1, encoders: 0 });
    const plan = planPaste(kb, some, 2, "replace", true);
    expect(plan.writes).toEqual([{ kind: "key", row: s.row, col: s.col, from: KC_NO, to: C }]);
    expect(kb.getKey(2, p.row, p.col)).toBe(B);
  });
});

describe("swap, clear, duplicate", () => {
  it("swaps two layers as one undo step", async () => {
    const { kb, sim, p, s } = await twoLayers();
    await swapLayers(kb, 1, 2, "Swap");
    expect(sim.getKeycode(1, p.row, p.col)).toBe(B);
    expect(sim.getKeycode(2, s.row, s.col)).toBe(C);
    expect(kb.history.nextUndo?.label).toBe("Swap");
    await kb.history.undo();
    expect(sim.getKeycode(1, p.row, p.col)).toBe(A);
    expect(sim.getKeycode(2, p.row, p.col)).toBe(B);
  });

  it("clears to transparent (KC_NO on layer 0) as one undo step", async () => {
    const { kb, sim, p, s } = await twoLayers();
    await applyLayerWrites(kb, 1, planClear(kb, 1), "Clear");
    expect(sim.getKeycode(1, s.row, s.col)).toBe(KC_TRNS);
    expect(planClear(kb, 0).every((w) => w.to === KC_NO)).toBe(true);
    await kb.history.undo();
    expect(sim.getKeycode(1, p.row, p.col)).toBe(A);
  });

  it("finds the first empty, unnamed layer", async () => {
    const { kb } = await board();
    expect(firstEmptyLayer(kb)).toBe(1);
    expect(firstEmptyLayer(kb, (l) => l === 1)).toBe(2);
  });
});
