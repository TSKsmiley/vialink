// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import { DYNAMIC_VIAL_KEY_OVERRIDE_GET, DYNAMIC_VIAL_KEY_OVERRIDE_SET } from "../protocol/constants.ts";
import { KO_ENABLED, type KeyOverrideEntry } from "../protocol/key-overrides.ts";
import { defaultKeyOverride, installKeyOverrides } from "../sim/key-overrides.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { applyVilRestore, parseVil, planVilRestore, saveVil } from "../vil.ts";
import { keyOverridesExtension } from "./key-overrides.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

const KC_A = 0x04;
const KC_B = 0x05;
const LSFT_KC_B = 0x0205;
const QK_BOOT_V6 = 0x7c00;

const shiftA: KeyOverrideEntry = {
  trigger: KC_A,
  replacement: LSFT_KC_B,
  layers: 0x0005,
  triggerMods: 0x02,
  negativeModMask: 0x01,
  suppressedMods: 0x02,
  options: KO_ENABLED | 0x01,
};

interface BoardOptions {
  vialProtocol?: number;
  count?: number;
  entries?: KeyOverrideEntry[];
  /** Leave the sim without the key override handler (firmware lacking the sub-command). */
  noHandler?: boolean;
}

async function board(opts: BoardOptions = {}) {
  const count = opts.count ?? 3;
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol ?? 6,
    dynamic: { tapDance: 0, combo: 0, keyOverride: count, altRepeatKey: 0, featureFlags: 0 },
  });
  const store = opts.noHandler ? null : installKeyOverrides(sim, { count, entries: opts.entries });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, store, kb, ko: kb.extension(keyOverridesExtension) };
}

const sets = (sim: SimulatedKeyboard) =>
  sim.requests.filter((r) => r[0] === 0xfe && r[1] === 0x0d && r[2] === DYNAMIC_VIAL_KEY_OVERRIDE_SET);

describe("key overrides extension", () => {
  it("loads every entry on boards that support it", async () => {
    const { ko, sim } = await board({ entries: [shiftA] });
    expect(ko?.count).toBe(3);
    expect(ko?.get(0)).toEqual(shiftA);
    expect(ko?.get(1)).toEqual(defaultKeyOverride());
    const gets = sim.requests.filter((r) => r[1] === 0x0d && r[2] === DYNAMIC_VIAL_KEY_OVERRIDE_GET);
    expect(gets.map((r) => r[3])).toEqual([0, 1, 2]);
  });

  it("is inactive without entries, below Vial protocol 5, or when the board ignores the get", async () => {
    expect((await board({ count: 0 })).ko).toBeNull();
    expect((await board({ vialProtocol: 4 })).ko).toBeNull();
    const ignored = await board({ noHandler: true });
    expect(ignored.ko).toBeNull();
    expect(saveVil(ignored.kb)).not.toContain("key_override");
  });

  it("writes only changed entries and updates the simulator", async () => {
    const { ko, sim, store, kb } = await board();
    let notified = 0;
    kb.subscribe(() => notified++);
    await ko!.set(0, { ...defaultKeyOverride() });
    expect(sets(sim)).toHaveLength(0);
    expect(notified).toBe(0);

    await ko!.set(2, shiftA);
    expect(sets(sim)).toHaveLength(1);
    expect(store!.get(2)).toEqual(shiftA);
    expect(ko!.get(2)).toEqual(shiftA);
    expect(notified).toBe(1);
  });

  it("applies quick successive toggles on top of each other", async () => {
    const { ko, store } = await board();
    await Promise.all([
      ko!.update(0, (e) => ({ layers: e.layers & ~0x0001 })),
      ko!.update(0, (e) => ({ layers: e.layers & ~0x0002 })),
      ko!.update(0, (e) => ({ options: e.options | KO_ENABLED })),
    ]);
    expect(store!.get(0).layers).toBe(0xfffc);
    expect(store!.get(0).options & KO_ENABLED).toBe(KO_ENABLED);
  });

  it("drops the unused option bit 6, as KeyOverrideOptions does", async () => {
    const { ko, store } = await board({ entries: [{ ...shiftA, options: 0xff }] });
    expect(ko!.get(0).options).toBe(0xbf);
    await ko!.update(0, { options: 0xff }); // same after masking: no write
    expect(store!.get(0).options).toBe(0xff);
  });

  it("rejects out-of-range values without writing", async () => {
    const { ko, sim } = await board();
    await expect(ko!.update(0, { layers: 0x10000 })).rejects.toThrow(/layers/);
    await expect(ko!.update(0, { triggerMods: -1 })).rejects.toThrow(/trigger mods/);
    expect(sets(sim)).toHaveLength(0);
  });

  it("asks for an unlock before setting QK_BOOT as the replacement", async () => {
    const { ko, sim, store, kb } = await board();
    await expect(ko!.update(0, { replacement: QK_BOOT_V6 })).rejects.toBeInstanceOf(UnlockRequiredError);
    expect(sets(sim)).toHaveLength(0);

    // Other replacements do not need it (vial-gui only unlocks for RESET_KEYCODE).
    await ko!.update(0, { replacement: KC_B });
    expect(store!.get(0).replacement).toBe(KC_B);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    await ko!.update(0, { replacement: QK_BOOT_V6 });
    expect(asked).toMatch(/QK_BOOT/);
    expect(store!.get(0).replacement).toBe(QK_BOOT_V6);
  });

  it("saves the key_override field in vial-gui's format", async () => {
    const { kb } = await board({ entries: [shiftA] });
    expect(saveVil(kb)).toContain(
      '"key_override": [' +
        '{"trigger": "KC_A", "replacement": "LSFT(KC_B)", "layers": 5, "trigger_mods": 2, ' +
        '"negative_mod_mask": 1, "suppressed_mods": 2, "options": 129}, ' +
        '{"trigger": "KC_NO", "replacement": "KC_NO", "layers": 65535, "trigger_mods": 0, ' +
        '"negative_mod_mask": 0, "suppressed_mods": 0, "options": 7}, ' +
        '{"trigger": "KC_NO", "replacement": "KC_NO", "layers": 65535, "trigger_mods": 0, ' +
        '"negative_mod_mask": 0, "suppressed_mods": 0, "options": 7}]',
    );
    // vial-gui's key order: key_override after combo, before layer_names etc.
    const keys = Object.keys(JSON.parse(saveVil(kb)) as object);
    expect(keys.indexOf("key_override")).toBeGreaterThan(keys.indexOf("via_protocol"));
  });

  // A file as vial-gui's keyboard_comm.py save_layout() writes it: json.dumps of
  // a dict whose "key_override" is [KeyOverrideEntry.save() for each entry].
  const vialGuiKeyOverrides =
    '[{"trigger": "KC_A", "replacement": "LSFT(KC_B)", "layers": 5, "trigger_mods": 2, ' +
    '"negative_mod_mask": 1, "suppressed_mods": 2, "options": 129}, ' +
    '{"trigger": "KC_NO", "replacement": "KC_NO", "layers": 65535, "trigger_mods": 0, ' +
    '"negative_mod_mask": 0, "suppressed_mods": 0, "options": 7}, ' +
    '{"trigger": "KC_ESCAPE", "replacement": "KC_GRAVE", "layers": 3, "trigger_mods": 34, ' +
    '"negative_mod_mask": 0, "suppressed_mods": 34, "options": 128}]';
  const vialGuiFile =
    '{"version": 1, "uid": 1234605616436508552, ' +
    '"layout": [[["KC_NO", "KC_NO"], ["KC_NO", "KC_NO"]], [["KC_NO", "KC_NO"], ["KC_NO", "KC_NO"]]], ' +
    '"encoder_layout": [[["KC_NO", "KC_NO"]], [["KC_NO", "KC_NO"]]], "layout_options": -1, ' +
    '"macro": [], "vial_protocol": 6, "via_protocol": 9, "tap_dance": [], "combo": [], ' +
    `"key_override": ${vialGuiKeyOverrides}, "alt_repeat_key": [], "settings": {}}`;

  it("restores a vial-gui file with one step per differing entry, then saves it back identically", async () => {
    const { kb, store, sim } = await board();
    const plan = planVilRestore(kb, parseVil(vialGuiFile));
    expect(plan.skippedFeatures).toEqual([]);
    const steps = plan.ops.filter((op) => op.kind === "extension");
    expect(steps.map((op) => op.description)).toEqual([
      "Set key override 1 (KC_A → LSFT(KC_B), enabled)",
      "Set key override 3 (KC_ESCAPE → KC_GRAVE, enabled)",
    ]);
    await applyVilRestore(kb, plan);
    expect(sets(sim)).toHaveLength(2);
    expect(store!.get(0)).toEqual(shiftA);
    expect(store!.get(2)).toEqual({
      trigger: 0x29,
      replacement: 0x35,
      layers: 3,
      triggerMods: 34,
      negativeModMask: 0,
      suppressedMods: 34,
      options: 128,
    });
    expect(saveVil(kb)).toContain(`"key_override": ${vialGuiKeyOverrides}`);
    expect(planVilRestore(kb, parseVil(vialGuiFile)).ops.filter((op) => op.kind === "extension")).toEqual([]);
  });

  it("ignores extra and malformed file entries and parses keycodes like Keycode.deserialize", async () => {
    const { kb } = await board({ count: 2 });
    const file = parseVil(
      JSON.stringify({
        uid: 1,
        layout: [],
        key_override: [
          {
            trigger: "KC_A",
            replacement: "NOT_A_KEYCODE",
            layers: 1,
            trigger_mods: 0,
            negative_mod_mask: 0,
            suppressed_mods: 0,
            options: 128,
          },
          { trigger: "KC_A", replacement: "KC_B", layers: 1 }, // missing fields
          {
            trigger: "KC_A",
            replacement: "KC_B",
            layers: 1,
            trigger_mods: 0,
            negative_mod_mask: 0,
            suppressed_mods: 0,
            options: 128,
          },
        ],
      }),
    );
    const steps = planVilRestore(kb, file).ops.filter((op) => op.kind === "extension");
    expect(steps.map((op) => op.description)).toEqual(["Set key override 1 (KC_A → KC_NO, enabled)"]);
  });

  it("reports key overrides in a file as skipped when the board lacks them", async () => {
    const { kb } = await board({ count: 0 });
    expect(planVilRestore(kb, parseVil(vialGuiFile)).skippedFeatures).toEqual(["key overrides"]);
  });

  it("asks for an unlock when a restore sets QK_BOOT", async () => {
    const { kb } = await board();
    const file = parseVil(vialGuiFile.replace('"replacement": "KC_GRAVE"', '"replacement": "QK_BOOT"'));
    const plan = planVilRestore(kb, file);
    await expect(applyVilRestore(kb, plan)).rejects.toBeInstanceOf(UnlockRequiredError);
  });
});
