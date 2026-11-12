// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "../keyboard.ts";
import { CMD_VIA_MACRO_GET_BUFFER, CMD_VIA_MACRO_SET_BUFFER } from "../protocol/constants.ts";
import { MacroError, type MacroAction } from "../protocol/macros.ts";
import { installMacroSimulator, type SimulatedMacroOptions } from "../sim/macros.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { parseVil, planVilRestore, saveVil } from "../vil.ts";
import { macrosExtension } from "./macros.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);
const ascii = (s: string) => [...new TextEncoder().encode(s)];

async function board(
  macros: SimulatedMacroOptions | null = { count: 4, memory: 100 },
  opts: { vialProtocol?: number; unlocked?: boolean } = {},
) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol ?? 6,
    unlocked: opts.unlocked ?? false,
  });
  const mem = macros ? installMacroSimulator(sim, macros) : null;
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, mem: mem!, kb, macros: kb.extension(macrosExtension) };
}

const sent = (sim: SimulatedKeyboard, cmd: number) => sim.requests.filter((r) => r[0] === cmd);

describe("macros extension", () => {
  it("is active only when the board has macros and macro memory", async () => {
    expect((await board()).macros?.count).toBe(4);
    expect((await board(null)).macros).toBeNull();
    expect((await board({ count: 0, memory: 100 })).macros).toBeNull();
    expect((await board({ count: 4, memory: 0 })).macros).toBeNull();
  });

  it("reads the buffer in 28-byte chunks and stops once it has every macro", async () => {
    const contents = Uint8Array.from([...ascii("hi"), 0, 1, 1, 4, 0, 0, 0, ...ascii("junk")]);
    const { sim, macros } = await board({ count: 4, memory: 200, contents });
    const reads = sent(sim, CMD_VIA_MACRO_GET_BUFFER);
    expect(reads).toHaveLength(1);
    expect([...reads[0].slice(0, 4)]).toEqual([0x0e, 0, 0, 28]);
    expect(macros!.macros).toEqual([
      [{ type: "text", text: "hi" }],
      [{ type: "tap", keys: ["KC_A"] }],
      [],
      [],
    ]);
    // reload_macros_late keeps exactly macro_count NUL-terminated macros.
    expect([...macros!.buffer]).toEqual([...ascii("hi"), 0, 1, 1, 4, 0, 0, 0]);
  });

  it("reads to the end of a buffer without enough NULs, with a short last chunk", async () => {
    const contents = new Uint8Array(60).fill(0x41);
    const { sim, macros } = await board({ count: 2, memory: 60, contents });
    expect(sent(sim, CMD_VIA_MACRO_GET_BUFFER).map((r) => [r[1], r[2], r[3]])).toEqual([
      [0, 0, 28],
      [0, 28, 28],
      [0, 56, 4],
    ]);
    expect(macros!.buffer.length).toBe(62); // 60 bytes of M0, then two terminators
  });

  it("asks for an unlock and writes the whole buffer in chunks", async () => {
    const { sim, mem, kb, macros } = await board({ count: 2, memory: 64 });
    const m = macros!;
    const wanted: MacroAction[][] = [
      [{ type: "text", text: "x".repeat(30) }],
      [
        { type: "down", keys: ["KC_LCTRL"] },
        { type: "tap", keys: ["KC_C"] },
        { type: "up", keys: ["KC_LCTRL"] },
      ],
    ];
    await expect(m.setMacros(wanted)).rejects.toBeInstanceOf(UnlockRequiredError);

    let asked = "";
    kb.unlockHandler = async (reason) => {
      asked = reason;
      sim.unlocked = true;
      return true;
    };
    let notified = 0;
    kb.subscribe(() => notified++);
    await m.setMacros(wanted);
    expect(asked).toBe("Saving macros");
    expect(notified).toBeGreaterThan(0);
    const data = [...ascii("x".repeat(30)), 0, 1, 2, 0xe0, 1, 1, 6, 1, 3, 0xe0, 0];
    expect([...mem.buffer.slice(0, data.length)]).toEqual(data);
    expect(sent(sim, CMD_VIA_MACRO_SET_BUFFER).map((r) => [r[1], r[2], r[3]])).toEqual([
      [0, 0, 28],
      [0, 28, data.length - 28],
    ]);
    expect(m.macros).toEqual(wanted);

    // Unchanged: nothing is sent.
    const before = sim.requests.length;
    await m.setMacros(wanted);
    expect(sim.requests.length).toBe(before);
  });

  it("refuses a buffer bigger than the macro memory", async () => {
    const { sim, macros } = await board({ count: 1, memory: 10 }, { unlocked: true });
    await expect(macros!.setMacros([[{ type: "text", text: "0123456789" }]])).rejects.toBeInstanceOf(
      MacroError,
    );
    expect(sent(sim, CMD_VIA_MACRO_SET_BUFFER)).toHaveLength(0);
  });

  it("uses the v1 format below Vial protocol 2", async () => {
    const contents = Uint8Array.from([...ascii("ab"), 1, 4, 2, 5, 0]);
    const { mem, macros } = await board(
      { count: 1, memory: 40, contents },
      { vialProtocol: 1, unlocked: true },
    );
    expect(macros!.macros).toEqual([
      [
        { type: "text", text: "ab" },
        { type: "tap", keys: ["KC_A"] },
        { type: "down", keys: ["KC_B"] },
      ],
    ]);
    await macros!.setMacros([[{ type: "up", keys: ["KC_A"] }]]);
    expect([...mem.buffer.slice(0, 3)]).toEqual([3, 4, 0]);
  });

  it("reverts to what the board holds", async () => {
    const { mem, macros } = await board({ count: 2, memory: 40 });
    mem.buffer.set([...ascii("new"), 0, 0]);
    await macros!.reload();
    expect(macros!.macros[0]).toEqual([{ type: "text", text: "new" }]);
  });

  it("saves the macro field exactly as vial-gui's save_macro() does", async () => {
    const contents = Uint8Array.from([
      ...ascii("Hello"),
      1, 1, 0x28, // tap KC_ENTER
      0,
      1, 2, 0xe0, 1, 1, 6, 1, 3, 0xe0, // down KC_LCTRL, tap KC_C, up KC_LCTRL
      0,
      1, 4, 101, 1, 1, 5, 0x04, 0x02, 1, 5, 0x05, 0x02, // delay 100, tap LSFT(KC_A) LSFT(KC_B)
      0,
      0,
    ]); // prettier-ignore
    const { kb } = await board({ count: 4, memory: 100, contents });
    const macroField =
      '"macro": [[["text", "Hello"], ["tap", "KC_ENTER"]], ' +
      '[["down", "KC_LCTRL"], ["tap", "KC_C"], ["up", "KC_LCTRL"]], ' +
      '[["delay", 100], ["tap", "LSFT(KC_A)", "LSFT(KC_B)"]], []]';
    const text = saveVil(kb);
    expect(text).toContain(`"layout_options": 0, ${macroField}, "vial_protocol": 6`);
    // Saving and loading again is a no-op.
    expect(planVilRestore(kb, parseVil(text)).ops).toEqual([]);
  });

  it("restores a vial-gui file: one step per differing macro, one buffer write", async () => {
    const { sim, mem, kb, macros } = await board({ count: 3, memory: 60 }, { unlocked: true });
    // As vial-gui's save_layout() writes it, with an unknown tag that restore_macros skips
    // and a fourth macro the board has no room for.
    const file = parseVil(
      '{"version": 1, "uid": 1, "layout": [], "layout_options": -1, ' +
        '"macro": [[["text", "Hi"], ["beep"]], [], [["tap", "KC_A", 4], ["delay", 1000]], [["text", "extra"]]], ' +
        '"vial_protocol": 6, "via_protocol": 9}',
    );
    const plan = planVilRestore(kb, file);
    expect(plan.skippedFeatures).toEqual([]);
    const steps = plan.ops.filter((op) => op.kind === "extension");
    expect(steps.map((s) => s.description)).toEqual([
      'Set macro M0: text "Hi"',
      "Set macro M2: tap KC_A 4, delay 1000 ms",
    ]);
    for (const step of steps) await step.apply();
    expect(sent(sim, CMD_VIA_MACRO_SET_BUFFER)).toHaveLength(1);
    const data = [...ascii("Hi"), 0, 0, 1, 1, 4, 1, 1, 4, 1, 4, 236, 4, 0];
    expect([...mem.buffer.slice(0, data.length)]).toEqual(data);
    expect(macros!.macros[2]).toEqual([
      { type: "tap", keys: ["KC_A", "KC_A"] },
      { type: "delay", delay: 1000 },
    ]);
    expect(planVilRestore(kb, file).ops).toEqual([]);
  });

  it("truncates a file that does not fit, as restore_macros does", async () => {
    const { mem, kb } = await board({ count: 2, memory: 6 }, { unlocked: true });
    const file = parseVil('{"layout": [], "macro": [[["text", "abc"]], [["text", "defg"]]]}');
    const steps = planVilRestore(kb, file).ops.filter((op) => op.kind === "extension");
    expect(steps.map((s) => s.description)).toEqual([
      'Set macro M0: text "abc"',
      'Set macro M1: text "defg"',
    ]);
    for (const step of steps) await step.apply();
    expect([...mem.buffer]).toEqual([...ascii("abc"), 0, ...ascii("de")]);
  });

  it("needs an unlock for restore writes", async () => {
    const { kb } = await board({ count: 1, memory: 20 });
    const [step] = planVilRestore(kb, parseVil('{"layout": [], "macro": [[["text", "a"]]]}')).ops;
    expect(step.kind).toBe("extension");
    if (step.kind === "extension") await expect(step.apply()).rejects.toBeInstanceOf(UnlockRequiredError);
  });

  it("ignores a missing or malformed macro field", async () => {
    const { kb } = await board();
    expect(planVilRestore(kb, parseVil('{"layout": []}')).ops).toEqual([]);
    expect(planVilRestore(kb, parseVil('{"layout": [], "macro": {}}')).ops).toEqual([]);
  });
});
