// SPDX-License-Identifier: GPL-2.0-or-later
// Undo and redo of every write kind against the simulated KLOR with every
// Vial feature. After each undo/redo, a fresh Keyboard reads the simulated
// board back, so the tests check what reached the board, not just the cache.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { altRepeatKeyExtension } from "./extensions/alt-repeat-key.ts";
import { combosExtension } from "./extensions/combos.ts";
import { keyOverridesExtension } from "./extensions/key-overrides.ts";
import { layerNamesExtension } from "./extensions/layerNames.ts";
import { macrosExtension } from "./extensions/macros.ts";
import { qmkSettingsExtension } from "./extensions/qmk-settings.ts";
import { tapDanceExtension } from "./extensions/tap-dance.ts";
import { HistoryError } from "./history.ts";
import { Keyboard } from "./keyboard.ts";
import { installAltRepeatKey } from "./sim/alt-repeat-key.ts";
import { installCombos } from "./sim/combos.ts";
import { installKeyOverrides } from "./sim/key-overrides.ts";
import { installMacroSimulator } from "./sim/macros.ts";
import { installQmkSettings } from "./sim/qmk-settings.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "./sim/tap-dance.ts";
import { RequestQueue } from "./transport/queue.ts";
import { applyVilRestore, parseVil, planVilRestore, saveVil } from "./vil.ts";

const KC_A = 0x04;
const KC_B = 0x05;
const KC_C = 0x06;

async function klor() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    keymap: [[[KC_A]]],
    macroCount: 4,
    macroBufferSize: 256,
    dynamic: { tapDance: 4, combo: 4, keyOverride: 4, altRepeatKey: 4, featureFlags: 0b11 },
    layerNames: ["Base", "Lower", "Raise", "Adjust"],
    unlocked: true,
  });
  installMacroSimulator(sim, { count: 4, memory: 256 });
  installTapDanceSimulator(sim, { count: 4 });
  installCombos(sim, { count: 4 });
  installKeyOverrides(sim, { count: 4 });
  installAltRepeatKey(sim, { count: 4 });
  installQmkSettings(sim);
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  /** Reads the whole board again, as a reconnect would. */
  const reread = () => Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb, reread };
}

async function encoderBoard() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    keymap: [[[KC_A, KC_B]]],
  });
  await sim.open();
  return { sim, kb: await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 })) };
}

/**
 * Checks one write kind: `read` gives the value on a keyboard, `change` makes
 * the write. Undo must bring back the old value on the board, redo the new one.
 */
async function roundTrip<T>(read: (kb: Keyboard) => T, change: (kb: Keyboard) => Promise<void>) {
  const { kb, reread } = await klor();
  const before = read(kb);
  await change(kb);
  const after = read(kb);
  expect(after).not.toEqual(before);
  expect(kb.history.canUndo).toBe(true);
  expect(read(await reread())).toEqual(after);

  await kb.history.undo();
  expect(read(kb)).toEqual(before);
  expect(read(await reread())).toEqual(before);
  expect(kb.history.canUndo).toBe(false);
  expect(kb.history.canRedo).toBe(true);

  await kb.history.redo();
  expect(read(kb)).toEqual(after);
  expect(read(await reread())).toEqual(after);
  expect(kb.history.canRedo).toBe(false);
  return kb;
}

describe("undo history: every write kind", () => {
  it("keys", async () => {
    const kb = await roundTrip(
      (k) => k.getKey(0, 0, 1),
      (k) => k.setKey(0, 0, 1, KC_C),
    );
    expect(kb.history.nextUndo?.label).toMatch(/Layer 0, key \(0, 1\)/);
  });

  it("encoders", async () => {
    const { sim, kb } = await encoderBoard();
    const before = kb.getEncoder(0, 0, 0);
    await kb.setEncoder(0, 0, 0, KC_C);
    await kb.history.undo();
    expect(kb.getEncoder(0, 0, 0)).toBe(before);
    expect(sim.getEncoder(0, 0, 0)).toBe(before);
    await kb.history.redo();
    expect(sim.getEncoder(0, 0, 0)).toBe(KC_C);
  });

  it("layout options", async () => {
    await roundTrip(
      (k) => k.layoutOptions,
      (k) => k.setLayoutChoices(k.layoutChoices.map((c, i) => (i === 0 ? (c === 0 ? 1 : 0) : c))),
    );
  });

  it("layer names", async () => {
    await roundTrip(
      (k) => k.extension(layerNamesExtension)!.get(1),
      (k) => k.extension(layerNamesExtension)!.set(1, "Nav"),
    );
  });

  it("tap dance", async () => {
    await roundTrip(
      (k) => k.extension(tapDanceExtension)!.get(0),
      (k) =>
        k.extension(tapDanceExtension)!.set(0, { ...k.extension(tapDanceExtension)!.get(0), onTap: KC_B }),
    );
  });

  it("combos", async () => {
    await roundTrip(
      (k) => k.extension(combosExtension)!.get(0),
      (k) => k.extension(combosExtension)!.set(0, [KC_A, KC_B, 0, 0, KC_C]),
    );
  });

  it("key overrides", async () => {
    await roundTrip(
      (k) => k.extension(keyOverridesExtension)!.get(0),
      (k) => k.extension(keyOverridesExtension)!.update(0, { trigger: KC_A, replacement: KC_B }),
    );
  });

  it("alt repeat keys", async () => {
    await roundTrip(
      (k) => k.extension(altRepeatKeyExtension)!.get(0),
      (k) =>
        k.extension(altRepeatKeyExtension)!.set(0, {
          ...k.extension(altRepeatKeyExtension)!.get(0),
          keycode: KC_A,
          altKeycode: KC_B,
        }),
    );
  });

  it("QMK settings", async () => {
    const qsid = (k: Keyboard) => k.extension(qmkSettingsExtension)!.qsids[0];
    await roundTrip(
      (k) => k.extension(qmkSettingsExtension)!.get(qsid(k)),
      (k) => {
        const qs = k.extension(qmkSettingsExtension)!;
        return qs.set(qsid(k), (qs.get(qsid(k))! + 1) % 2);
      },
    );
  });

  it("macros (Save is one entry)", async () => {
    await roundTrip(
      (k) => Array.from(k.extension(macrosExtension)!.buffer),
      (k) => k.extension(macrosExtension)!.setMacros([[{ type: "text", text: "hi" }], [], [], []]),
    );
  });
});

describe("undo history: behaviour", () => {
  it("loading a .vil file is one entry", async () => {
    const { kb } = await klor();
    const saved = saveVil(kb);
    await kb.setKey(0, 0, 1, KC_C);
    await kb.setKey(0, 0, 2, KC_C);
    await kb
      .extension(tapDanceExtension)!
      .set(0, { ...kb.extension(tapDanceExtension)!.get(0), onTap: KC_B });
    const plan = planVilRestore(kb, parseVil(saved));
    await applyVilRestore(kb, plan, undefined, "Load backup.vil");
    expect(kb.history.nextUndo?.label).toBe("Load backup.vil");
    expect(kb.history.nextUndo?.writes.length).toBe(3);
    await kb.history.undo();
    expect(kb.getKey(0, 0, 1)).toBe(KC_C);
    expect(kb.getKey(0, 0, 2)).toBe(KC_C);
    expect(kb.extension(tapDanceExtension)!.get(0).onTap).toBe(KC_B);
  });

  it("group() makes one entry, undone newest write first", async () => {
    const { kb } = await klor();
    await kb.history.group("Two writes to one key", async () => {
      await kb.setKey(0, 0, 1, KC_B);
      await kb.setKey(0, 0, 1, KC_C);
    });
    expect(kb.history.nextUndo?.writes.length).toBe(2);
    await kb.history.undo();
    expect(kb.getKey(0, 0, 1)).toBe(0); // the starting value, not KC_B
  });

  it("a new change clears redo; undo and redo are not recorded", async () => {
    const { kb } = await klor();
    await kb.setKey(0, 0, 1, KC_B);
    await kb.history.undo();
    expect(kb.history.canRedo).toBe(true);
    expect(kb.history.canUndo).toBe(false);
    await kb.setKey(0, 0, 2, KC_B);
    expect(kb.history.canRedo).toBe(false);
  });

  it("a failed undo stops, keeps the entry and names the write", async () => {
    const { kb } = await klor();
    const done: string[] = [];
    await kb.history.group("Paste", async () => {
      kb.history.record({ label: "first", undo: async () => void done.push("first"), redo: async () => {} });
      kb.history.record({
        label: "Layer 0, key (0, 3)",
        undo: () => Promise.reject(new Error("timeout")),
        redo: async () => {},
      });
    });
    await expect(kb.history.undo()).rejects.toThrow(HistoryError);
    await expect(kb.history.undo()).rejects.toThrow(/Layer 0, key \(0, 3\): timeout/);
    expect(done).toEqual([]); // newest first: stopped before "first"
    expect(kb.history.canUndo).toBe(true);
    expect(kb.history.canRedo).toBe(false);
    expect(kb.history.busy).toBe(false);
  });

  it("asks before undoing a value that changed elsewhere", async () => {
    const { kb } = await klor();
    let current = true;
    kb.history.record({ label: "x", undo: async () => {}, redo: async () => {}, isCurrent: () => current });
    current = false;
    kb.history.setConfirmStale(async () => false);
    expect(await kb.history.undo()).toBeNull();
    expect(kb.history.canUndo).toBe(true);
    kb.history.setConfirmStale(async () => true);
    expect(await kb.history.undo()).not.toBeNull();
  });

  it("reports each change to subscribers", async () => {
    const { kb } = await klor();
    const kinds: string[] = [];
    kb.history.subscribe((e) => e && kinds.push(e.kind));
    await kb.setKey(0, 0, 1, KC_B);
    await kb.history.undo();
    await kb.history.redo();
    expect(kinds).toEqual(["recorded", "undone", "redone"]);
  });
});
