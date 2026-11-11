// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import type { AltRepeatKeyEntry } from "../protocol/alt-repeat-key.ts";
import { installAltRepeatKey } from "../sim/alt-repeat-key.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { toHex } from "../util/bytes.ts";
import { parseVil, planVilRestore, saveVil } from "../vil.ts";
import { altRepeatKeyExtension } from "./alt-repeat-key.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

const KC_A = 0x04;
const KC_E = 0x08;
const KC_R = 0x15;
const QK_BOOT = 0x7c00;

async function board(opts: { count?: number; vialProtocol?: number; entries?: AltRepeatKeyEntry[] } = {}) {
  const count = opts.count ?? 4;
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol,
    dynamic: { tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: count, featureFlags: 0 },
  });
  const arep = installAltRepeatKey(sim, {
    count,
    entries: opts.entries ?? [{ keycode: KC_E, altKeycode: KC_R, allowedMods: 0, options: 0x08 }],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, arep, kb };
}

/** What vial-gui's save_layout() writes for this field (json.dumps of save_alt_repeat_key()). */
const VIAL_GUI_SAMPLE =
  '"alt_repeat_key": [' +
  '{"keycode": "KC_E", "alt_keycode": "KC_R", "allowed_mods": 0, "options": 8}, ' +
  '{"keycode": "KC_A", "alt_keycode": "LSFT(KC_B)", "allowed_mods": 17, "options": 9}, ' +
  '{"keycode": "KC_NO", "alt_keycode": "KC_NO", "allowed_mods": 0, "options": 0}, ' +
  '{"keycode": "QK_BOOT", "alt_keycode": "KC_ESCAPE", "allowed_mods": 255, "options": 15}]';

describe("alt repeat key extension", () => {
  it("is inactive when the board reports no entries or predates dynamic entries", async () => {
    const none = await board({ count: 0 });
    expect(none.kb.extension(altRepeatKeyExtension)).toBeNull();
    expect(saveVil(none.kb)).not.toContain("alt_repeat_key");
    const old = await board({ vialProtocol: 3 });
    expect(old.kb.extension(altRepeatKeyExtension)).toBeNull();
  });

  it("loads every entry from the board", async () => {
    const { kb, sim } = await board({
      entries: [
        { keycode: KC_E, altKeycode: KC_R, allowedMods: 0x22, options: 0xf9 },
        { keycode: 0x0205, altKeycode: KC_A, allowedMods: 0, options: 0 },
      ],
    });
    const arep = kb.extension(altRepeatKeyExtension)!;
    expect(arep.count).toBe(4);
    // Options go through AltRepeatKeyOptions: bits 0-3 only.
    expect(arep.get(0)).toEqual({ keycode: KC_E, altKeycode: KC_R, allowedMods: 0x22, options: 0x09 });
    expect(arep.get(1)).toEqual({ keycode: 0x0205, altKeycode: KC_A, allowedMods: 0, options: 0 });
    const gets = sim.requests.filter((r) => r[0] === 0xfe && r[1] === 0x0d && r[2] === 0x07);
    expect(gets.map((r) => toHex(r.slice(0, 4)))).toEqual(["fe0d0700", "fe0d0701", "fe0d0702", "fe0d0703"]);
  });

  it("writes changed entries only, and updates the board", async () => {
    const { kb, sim, arep } = await board();
    const state = kb.extension(altRepeatKeyExtension)!;
    let changes = 0;
    kb.subscribe(() => changes++);

    const before = sim.requests.length;
    await state.set(0, { keycode: KC_E, altKeycode: KC_R, allowedMods: 0, options: 0x08 });
    expect(sim.requests.length).toBe(before);
    expect(changes).toBe(0);

    await state.set(2, { keycode: KC_A, altKeycode: 0x0205, allowedMods: 0x11, options: 0x0b });
    expect(toHex(sim.requests.at(-1)!.slice(0, 10))).toBe("fe0d0802" + "0400" + "0502" + "11" + "0b");
    expect(arep.entries[2]).toEqual({ keycode: KC_A, altKeycode: 0x0205, allowedMods: 0x11, options: 0x0b });
    expect(state.get(2).options).toBe(0x0b);
    expect(changes).toBe(1);

    await expect(
      state.set(1, { keycode: 0x10000, altKeycode: 0, allowedMods: 0, options: 0 }),
    ).rejects.toThrow(/invalid keycode/);
  });

  it("reports a write the board rejects and keeps the old value", async () => {
    const { kb, sim } = await board();
    sim.handlers.unshift((msg) => {
      if (msg[0] !== 0xfe || msg[2] !== 0x08) return false;
      msg[0] = 0xff;
      return true;
    });
    const state = kb.extension(altRepeatKeyExtension)!;
    await expect(state.set(1, { keycode: KC_A, altKeycode: 0, allowedMods: 0, options: 8 })).rejects.toThrow(
      /rejected alt repeat key 2/,
    );
    expect(state.get(1).keycode).toBe(0);
  });

  it("asks for an unlock before assigning QK_BOOT, as vial-gui does", async () => {
    const { kb, sim, arep } = await board();
    const state = kb.extension(altRepeatKeyExtension)!;
    await expect(
      state.set(1, { keycode: KC_A, altKeycode: QK_BOOT, allowedMods: 0, options: 8 }),
    ).rejects.toBeInstanceOf(UnlockRequiredError);
    expect(arep.entries[1].altKeycode).toBe(0);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    await state.set(1, { keycode: KC_A, altKeycode: QK_BOOT, allowedMods: 0, options: 8 });
    expect(asked).toBe("Assigning QK_BOOT (bootloader) to an alt repeat key");
    expect(arep.entries[1].altKeycode).toBe(QK_BOOT);

    // Other keycodes need no unlock.
    sim.unlocked = false;
    kb.unlockHandler = null;
    await state.set(2, { keycode: KC_A, altKeycode: KC_R, allowedMods: 0, options: 8 });
    expect(arep.entries[2]).toEqual({ keycode: KC_A, altKeycode: KC_R, allowedMods: 0, options: 8 });
  });

  it("saves in vial-gui's format", async () => {
    const { kb } = await board();
    const text = saveVil(kb);
    expect(text).toContain(
      '"alt_repeat_key": [{"keycode": "KC_E", "alt_keycode": "KC_R", "allowed_mods": 0, "options": 8}, ' +
        '{"keycode": "KC_NO", "alt_keycode": "KC_NO", "allowed_mods": 0, "options": 0}, ' +
        '{"keycode": "KC_NO", "alt_keycode": "KC_NO", "allowed_mods": 0, "options": 0}, ' +
        '{"keycode": "KC_NO", "alt_keycode": "KC_NO", "allowed_mods": 0, "options": 0}]',
    );
    // vial-gui's key order: after via_protocol.
    expect(text.indexOf('"via_protocol"')).toBeLessThan(text.indexOf('"alt_repeat_key"'));
  });

  it("restores a vial-gui file entry by entry and saves it back identically", async () => {
    const { kb, sim, arep } = await board();
    const base = saveVil(kb);
    const file = parseVil(base.replace(/"alt_repeat_key": \[.*\]\}$/, VIAL_GUI_SAMPLE + "}"));
    expect(file.raw.alt_repeat_key).toHaveLength(4);

    const plan = planVilRestore(kb, file);
    expect(plan.skippedFeatures).toEqual([]);
    expect(plan.ops.map((op) => (op.kind === "extension" ? op.description : op.kind))).toEqual([
      "Set alt repeat key 2: KC_A → LSFT(KC_B) (enabled)",
      "Set alt repeat key 4: QK_BOOT → KC_ESCAPE (enabled)",
    ]);

    sim.unlocked = true;
    for (const op of plan.ops) if (op.kind === "extension") await op.apply();
    expect(arep.entries[1]).toEqual({ keycode: KC_A, altKeycode: 0x0205, allowedMods: 17, options: 9 });
    expect(arep.entries[3]).toEqual({ keycode: QK_BOOT, altKeycode: 0x29, allowedMods: 255, options: 15 });
    expect(saveVil(kb)).toContain(VIAL_GUI_SAMPLE);
    expect(planVilRestore(kb, file).ops).toEqual([]);
  });

  it("handles extra, short, unknown and malformed entries like vial-gui", async () => {
    const { kb } = await board({ count: 2 });
    const entries = [
      // Unknown keycodes deserialize to KC_NO; options keep bits 0-3 only.
      { keycode: "KC_BOGUS", alt_keycode: "KC_R", allowed_mods: 0, options: 0xf8 },
      { keycode: "KC_A" }, // malformed: skipped
      { keycode: "KC_A", alt_keycode: "KC_B", allowed_mods: 0, options: 8 }, // beyond the count
    ];
    const text = saveVil(kb).replace(
      /"alt_repeat_key": \[.*\]\}$/,
      `"alt_repeat_key": ${JSON.stringify(entries)}}`,
    );
    const plan = planVilRestore(kb, parseVil(text));
    expect(plan.ops.map((op) => (op.kind === "extension" ? op.description : op.kind))).toEqual([
      "Set alt repeat key 1: KC_NO → KC_R (enabled)",
    ]);
    expect(planVilRestore(kb, parseVil(text.replace(/, "alt_repeat_key": .*\}$/, "}"))).ops).toEqual([]);
  });

  it("reports the field as skipped when the board has no alt repeat keys", async () => {
    const { kb } = await board({ count: 0 });
    const plan = planVilRestore(
      kb,
      parseVil(
        '{"uid": 1, "layout": [], "layout_options": -1, "alt_repeat_key": [{"keycode": "KC_A", "alt_keycode": "KC_B", "allowed_mods": 0, "options": 8}]}',
      ),
    );
    expect(plan.skippedFeatures).toEqual(["alt repeat keys"]);
  });
});
