// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import type { ComboEntry } from "../protocol/combos.ts";
import { installCombos } from "../sim/combos.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { toHex } from "../util/bytes.ts";
import { parseVil, planVilRestore, saveVil } from "../vil.ts";
import { ComboError, combosExtension, describeCombo } from "./combos.ts";

const xz = new Uint8Array(
  readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
);

// v6 keycodes
const KC_A = 0x04;
const KC_S = 0x16;
const KC_D = 0x07;
const KC_ESC = 0x29;
const KC_TAB = 0x2b;
const QK_BOOT = 0x7c00;
const LCTL_C = 0x0106;

interface BoardOptions {
  count?: number;
  entries?: ComboEntry[];
  vialProtocol?: number;
  /** false: the board reports combos but has no handler (firmware without the command). */
  handler?: boolean;
}

async function board(opts: BoardOptions = {}) {
  const count = opts.count ?? 4;
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol,
    dynamic: { tapDance: 0, combo: count, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  const combos = opts.handler === false ? null : installCombos(sim, { count, entries: opts.entries });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb, combos };
}

describe("combos extension", () => {
  it("loads every combo entry when the board reports combos", async () => {
    const { kb, sim } = await board({ entries: [[KC_A, KC_S, 0, 0, KC_ESC]] });
    const combos = kb.extension(combosExtension)!;
    expect(combos.count).toBe(4);
    expect(combos.get(0)).toEqual([KC_A, KC_S, 0, 0, KC_ESC]);
    expect(combos.get(3)).toEqual([0, 0, 0, 0, 0]);
    const gets = sim.requests.filter((r) => toHex(r.slice(0, 3)) === "fe0d03").map((r) => r[3]);
    expect(gets).toEqual([0, 1, 2, 3]);
  });

  it("is inactive with no combos, before Vial protocol 4, or when the command is unanswered", async () => {
    expect((await board({ count: 0 })).kb.extension(combosExtension)).toBeNull();
    expect((await board({ vialProtocol: 3 })).kb.extension(combosExtension)).toBeNull();
    const silent = await board({ handler: false });
    expect(silent.kb.extension(combosExtension)).toBeNull();
    expect(saveVil(silent.kb)).not.toContain('"combo"');
  });

  it("fails the load when a later combo entry cannot be read, as vial-gui does", async () => {
    const sim = new SimulatedKeyboard({
      compressedDefinition: xz,
      rows: 2,
      cols: 2,
      layers: 2,
      encoderCount: 1,
      dynamic: { tapDance: 0, combo: 4, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
    });
    installCombos(sim, { count: 4 });
    // base_protocol.py _retrieve_dynamic_entries: data[0] != 0 raises.
    sim.handlers.unshift((msg) => {
      if (toHex(msg.slice(0, 3)) !== "fe0d03" || msg[3] !== 2) return false;
      msg[0] = 0xff;
      return true;
    });
    await sim.open();
    await expect(Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }))).rejects.toThrow(
      /failed retrieving combo entry 2/,
    );
  });

  it("simulator stores a QK_BOOT output as KC_NO while locked, like vial_keycode_firewall", async () => {
    const { sim, combos: stored } = await board();
    // FE 0D 04 idx=1, inputs KC_A KC_S 0 0, output QK_BOOT (little endian).
    const req = new Uint8Array(32);
    req.set([0xfe, 0x0d, 0x04, 0x01, 0x04, 0x00, 0x16, 0x00, 0, 0, 0, 0, 0x00, 0x7c]);
    const reply = await sim.send(req);
    expect(reply[0]).toBe(0);
    expect(stored!.entries[1]).toEqual([KC_A, KC_S, 0, 0, 0]);
    sim.unlocked = true;
    await sim.send(req);
    expect(stored!.entries[1]).toEqual([KC_A, KC_S, 0, 0, QK_BOOT]);
  });

  it("describes only the trigger keys before the first KC_NO, as the firmware reads them", async () => {
    const { kb } = await board();
    expect(describeCombo(kb.keycodes, [KC_A, KC_S, 0, 0, KC_ESC])).toBe("KC_A + KC_S → KC_ESCAPE");
    expect(describeCombo(kb.keycodes, [KC_A, 0, KC_S, 0, KC_ESC])).toBe(
      "KC_A → KC_ESCAPE (ignored after an empty slot: KC_S)",
    );
    expect(describeCombo(kb.keycodes, [0, KC_A, KC_S, 0, KC_ESC])).toBe(
      "(no keys) → KC_ESCAPE (ignored after an empty slot: KC_A, KC_S)",
    );
  });

  it("writes changed combos only, and updates state after the write", async () => {
    const { kb, sim, combos: stored } = await board();
    const combos = kb.extension(combosExtension)!;
    let notified = 0;
    kb.subscribe(() => notified++);

    await combos.set(1, [KC_A, KC_S, KC_D, 0, LCTL_C]);
    expect(stored!.entries[1]).toEqual([KC_A, KC_S, KC_D, 0, LCTL_C]);
    expect(combos.get(1)).toEqual([KC_A, KC_S, KC_D, 0, LCTL_C]);
    expect(notified).toBe(1);
    const last = sim.requests[sim.requests.length - 1];
    expect(toHex(last.slice(0, 14))).toBe("fe0d0401" + "0400" + "1600" + "0700" + "0000" + "0601");

    const before = sim.requests.length;
    await combos.set(1, [KC_A, KC_S, KC_D, 0, LCTL_C]);
    expect(sim.requests.length).toBe(before);

    await combos.setKey(1, 4, KC_TAB);
    expect(stored!.entries[1]).toEqual([KC_A, KC_S, KC_D, 0, KC_TAB]);
  });

  it("does not need an unlock for ordinary combos", async () => {
    const { kb, sim } = await board();
    await kb.extension(combosExtension)!.set(0, [KC_A, KC_S, 0, 0, KC_ESC]);
    expect(sim.unlocked).toBe(false);
  });

  it("asks for an unlock before assigning QK_BOOT as the output", async () => {
    const { kb, sim, combos: stored } = await board();
    const combos = kb.extension(combosExtension)!;
    await expect(combos.set(0, [KC_A, KC_S, 0, 0, QK_BOOT])).rejects.toBeInstanceOf(UnlockRequiredError);
    expect(stored!.entries[0]).toEqual([0, 0, 0, 0, 0]);
    expect(combos.get(0)).toEqual([0, 0, 0, 0, 0]);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    await combos.set(0, [KC_A, KC_S, 0, 0, QK_BOOT]);
    expect(asked).toBe("Assigning QK_BOOT (bootloader) to a combo");
    expect(stored!.entries[0]).toEqual([KC_A, KC_S, 0, 0, QK_BOOT]);
  });

  it("reports a rejected write and keeps the old state", async () => {
    const { kb, sim } = await board();
    const combos = kb.extension(combosExtension)!;
    sim.handlers.unshift((msg) => {
      if (toHex(msg.slice(0, 3)) !== "fe0d04") return false;
      msg[0] = 0xff;
      return true;
    });
    await expect(combos.set(0, [KC_A, 0, 0, 0, KC_ESC])).rejects.toBeInstanceOf(ComboError);
    expect(combos.get(0)).toEqual([0, 0, 0, 0, 0]);
  });

  it("saves combos in vial-gui's format and position", async () => {
    const { kb } = await board({ count: 2, entries: [[KC_A, KC_S, 0, 0, KC_ESC]] });
    const text = saveVil(kb);
    expect(text).toContain(
      '"combo": [["KC_A", "KC_S", "KC_NO", "KC_NO", "KC_ESCAPE"], ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO"]]',
    );
    // keyboard_comm.py save_layout(): combo comes after via_protocol.
    expect(text.indexOf('"via_protocol"')).toBeLessThan(text.indexOf('"combo"'));
  });

  it("restores a vial-gui .vil, one step per differing combo, and saves it back identically", async () => {
    // What vial-gui's save_layout() writes (json.dumps of the save_combo() tuples)
    // for a 4-combo board, with a masked keycode, QK_BOOT and an unused slot.
    const comboField =
      '"combo": [["KC_A", "KC_S", "KC_NO", "KC_NO", "KC_ESCAPE"], ' +
      '["KC_A", "KC_S", "KC_D", "KC_NO", "LCTL(KC_C)"], ' +
      '["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO"], ' +
      '["KC_TAB", "KC_ESCAPE", "KC_NO", "KC_NO", "QK_BOOT"]]';
    const vialGuiFile =
      '{"version": 1, "uid": 1234605616436508552, "layout": [[["KC_NO", "KC_NO"], ["KC_NO", "KC_NO"]], ' +
      '[["KC_NO", "KC_NO"], ["KC_NO", "KC_NO"]]], "encoder_layout": [[["KC_NO", "KC_NO"]], [["KC_NO", "KC_NO"]]], ' +
      '"layout_options": 0, "macro": [], "vial_protocol": 6, "via_protocol": 9, "tap_dance": [], ' +
      comboField +
      ', "key_override": [], "alt_repeat_key": [], "settings": {}}';

    const { kb, sim, combos: stored } = await board({ entries: [[KC_A, KC_S, 0, 0, KC_ESC]] });
    const plan = planVilRestore(kb, parseVil(vialGuiFile));
    expect(plan.skippedFeatures).toEqual([]);
    const steps = plan.ops.filter((op) => op.kind === "extension");
    expect(steps.map((op) => op.description)).toEqual([
      "Set combo 2 to KC_A + KC_S + KC_D → LCTL(KC_C)",
      "Set combo 4 to KC_TAB + KC_ESCAPE → QK_BOOT",
    ]);

    sim.unlocked = true;
    for (const op of steps) await op.apply();
    expect(stored!.entries).toEqual([
      [KC_A, KC_S, 0, 0, KC_ESC],
      [KC_A, KC_S, KC_D, 0, LCTL_C],
      [0, 0, 0, 0, 0],
      [KC_TAB, KC_ESC, 0, 0, QK_BOOT],
    ]);
    expect(saveVil(kb)).toContain(comboField);
    expect(planVilRestore(kb, parseVil(vialGuiFile)).ops).toEqual([]);
  });

  it("restores like vial-gui: unknown ids become KC_NO, extra entries are ignored", async () => {
    const { kb } = await board({ count: 1 });
    const file = parseVil(
      '{"uid": 1, "layout": [], "layout_options": -1, ' +
        '"combo": [["KC_A", "NOT_A_KEY", "KC_NO", "KC_NO", 41], ["KC_B", "KC_C", "KC_NO", "KC_NO", "KC_D"]]}',
    );
    const steps = planVilRestore(kb, file).ops.filter((op) => op.kind === "extension");
    expect(steps.map((op) => op.description)).toEqual([
      'Set combo 1 to KC_A → KC_ESCAPE (unknown "NOT_A_KEY" as KC_NO)',
    ]);
    await steps[0].apply();
    expect(kb.extension(combosExtension)!.get(0)).toEqual([KC_A, 0, 0, 0, KC_ESC]);
  });

  it("reports combos in a file as skipped when the board has none", async () => {
    const { kb } = await board({ count: 0 });
    const plan = planVilRestore(
      kb,
      parseVil(
        '{"uid": 1, "layout": [], "layout_options": -1, "combo": [["KC_A", "KC_B", "KC_NO", "KC_NO", "KC_C"]]}',
      ),
    );
    expect(plan.skippedFeatures).toEqual(["combos"]);
  });
});
