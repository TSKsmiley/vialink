// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import { installTapDanceSimulator, type SimTapDanceOptions } from "../sim/tap-dance.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { toHex } from "../util/bytes.ts";
import { applyVilRestore, parseVil, planVilRestore, saveVil } from "../vil.ts";
import { TapDanceError, tapDanceExtension } from "./tap-dance.ts";

const xz = new Uint8Array(
  readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
);
const vialGuiFile = readFileSync(resolve(process.cwd(), "fixtures/vil/test_2x2_encoder.vil"), "utf-8");

const KC_A = 0x04;
const KC_B = 0x05;
const KC_LCTL = 0xe0;
const QK_BOOT = 0x7c00;

async function board(
  opts: {
    count?: number;
    vialProtocol?: number;
    entries?: SimTapDanceOptions["entries"];
    handler?: boolean;
  } = {},
) {
  const count = opts.count ?? 2;
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol,
    uid: 18364758544493064720n,
    dynamic: { tapDance: count, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  const td = opts.handler === false ? null : installTapDanceSimulator(sim, { count, entries: opts.entries });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, td, kb };
}

describe("tap dance extension", () => {
  it("loads every entry on boards with tap dance", async () => {
    const { sim, kb } = await board({ entries: [{ onTap: KC_A, onHold: KC_LCTL, tappingTerm: 175 }] });
    const state = kb.extension(tapDanceExtension)!;
    expect(state.count).toBe(2);
    expect(state.get(0)).toEqual({
      onTap: KC_A,
      onHold: KC_LCTL,
      onDoubleTap: 0,
      onTapHold: 0,
      tappingTerm: 175,
    });
    expect(state.get(1).tappingTerm).toBe(200);
    const gets = sim.requests.map((r) => toHex(r.slice(0, 4))).filter((h) => h.startsWith("fe0d01"));
    expect(gets).toEqual(["fe0d0100", "fe0d0101"]);
  });

  it("is inactive without tap dance entries, on old protocols, or when the board does not answer", async () => {
    expect((await board({ count: 0 })).kb.extension(tapDanceExtension)).toBeNull();
    expect((await board({ vialProtocol: 3 })).kb.extension(tapDanceExtension)).toBeNull();
    const silent = await board({ handler: false });
    expect(silent.kb.extension(tapDanceExtension)).toBeNull();
    expect(saveVil(silent.kb)).not.toContain("tap_dance");
  });

  it("writes changed entries only, and updates state after the write", async () => {
    const { sim, td, kb } = await board();
    const state = kb.extension(tapDanceExtension)!;
    let notified = 0;
    kb.subscribe(() => notified++);

    const entry = { onTap: KC_A, onHold: KC_LCTL, onDoubleTap: KC_B, onTapHold: 0x0206, tappingTerm: 250 };
    await state.set(1, entry);
    expect(td!.entries[1]).toEqual(entry);
    expect(state.get(1)).toEqual(entry);
    expect(notified).toBe(1);
    const last = sim.requests[sim.requests.length - 1];
    expect(toHex(last.slice(0, 14))).toBe("fe0d0201" + "0400e00005000602fa00");

    const sent = sim.requests.length;
    await state.set(1, { ...entry });
    expect(sim.requests.length).toBe(sent);
    expect(notified).toBe(1);

    await expect(state.set(0, { ...entry, tappingTerm: 70000 })).rejects.toBeInstanceOf(TapDanceError);
    await expect(state.set(2, entry)).rejects.toBeInstanceOf(TapDanceError);
    expect(sim.requests.length).toBe(sent);
  });

  it("asks for an unlock before assigning QK_BOOT", async () => {
    const { sim, td, kb } = await board();
    const state = kb.extension(tapDanceExtension)!;
    const entry = { onTap: KC_A, onHold: QK_BOOT, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 };
    await expect(state.set(0, entry)).rejects.toBeInstanceOf(UnlockRequiredError);
    expect(td!.entries[0].onHold).toBe(0);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    await state.set(0, entry);
    expect(asked).toBe("Assigning QK_BOOT (bootloader) in a tap dance");
    expect(td!.entries[0]).toEqual(entry);

    // Entries without QK_BOOT need no unlock, as in vial-gui.
    sim.unlocked = false;
    kb.unlockHandler = null;
    await state.set(1, { ...entry, onHold: KC_B });
    expect(td!.entries[1].onHold).toBe(KC_B);
  });

  it("saves in vial-gui's format and position", async () => {
    const { kb } = await board({
      entries: [{ onTap: KC_A, onHold: KC_LCTL, onDoubleTap: KC_B, onTapHold: 0x0206, tappingTerm: 200 }],
    });
    const vil = saveVil(kb);
    expect(vil).toContain(
      '"via_protocol": 9, "tap_dance": [["KC_A", "KC_LCTRL", "KC_B", "LSFT(KC_C)", 200], ' +
        '["KC_NO", "KC_NO", "KC_NO", "KC_NO", 200]]}',
    );
    expect(planVilRestore(kb, parseVil(vil)).ops).toEqual([]);
  });

  it("restores a vial-gui file, one step per differing entry, and saves it back identically", async () => {
    // As keyboard_comm.py save_layout() writes it: json.dumps of save_tap_dance() tuples.
    const field =
      '"tap_dance": [["KC_A", "KC_LCTRL", "KC_B", "LSFT(KC_C)", 200], ["KC_NO", "KC_NO", "KC_NO", "KC_NO", 200], ' +
      '["KC_Z", "KC_NO", "KC_NO", "KC_NO", 300]]';
    const file = parseVil(vialGuiFile.replace('"tap_dance": []', field));
    const { sim, td, kb } = await board();

    const plan = planVilRestore(kb, file);
    expect(plan.skippedFeatures).not.toContain("tap dance");
    const steps = plan.ops.filter((op) => op.kind === "extension");
    // Entry 1 already matches; entry 2 is beyond the board's two entries.
    expect(steps.map((s) => s.description)).toEqual([
      "Set TD(0): tap KC_A, hold KC_LCTRL, double tap KC_B, tap + hold LSFT(KC_C), 200 ms",
    ]);
    sim.unlocked = true; // the file's keymap holds QK_BOOT
    await applyVilRestore(kb, plan);
    expect(td!.entries[0]).toEqual({
      onTap: KC_A,
      onHold: KC_LCTL,
      onDoubleTap: KC_B,
      onTapHold: 0x0206,
      tappingTerm: 200,
    });

    const saved = saveVil(kb);
    const twoEntries = field.replace(', ["KC_Z", "KC_NO", "KC_NO", "KC_NO", 300]', "");
    expect(saved).toContain(twoEntries);
    expect(saved.slice(saved.indexOf('"tap_dance"'))).toBe(twoEntries + "}");
    expect(planVilRestore(kb, parseVil(saved)).ops).toEqual([]);
  });

  it("restores legacy integers and normalizes unknown keycodes to KC_NO, skipping unpackable entries", async () => {
    const { kb } = await board({ count: 3, entries: [{ onTap: KC_B }, { onTap: KC_B }, { onTap: KC_B }] });
    const raw = {
      tap_dance: [
        [4, "NOT_A_KEYCODE", "KC_NO", "KC_NO", 200],
        ["KC_A", "KC_NO", "KC_NO", "KC_NO", -1],
        ["KC_A", "KC_NO"],
      ],
    };
    const steps = tapDanceExtension.vil!.restore(kb.extension(tapDanceExtension)!, raw);
    expect(steps.map((s) => s.description)).toEqual([
      "Set TD(0): tap KC_A, hold KC_NO, double tap KC_NO, tap + hold KC_NO, 200 ms",
    ]);
    expect(tapDanceExtension.vil!.restore(kb.extension(tapDanceExtension)!, {})).toEqual([]);
  });
});
