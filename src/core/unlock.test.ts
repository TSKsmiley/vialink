// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard, UnlockRequiredError } from "./keyboard.ts";
import { fromHex, padTo, toHex } from "./util/bytes.ts";
import {
  matrixStateFits,
  viaGetMatrixState,
  vialLock,
  vialUnlockPoll,
  vialUnlockStart,
} from "./protocol/commands.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";
import { runUnlock } from "./unlock.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

async function board(opts: { vialProtocol?: number } = {}) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol,
  });
  await sim.open();
  const queue = new RequestQueue(sim, { retryDelayMs: 0 });
  const kb = await Keyboard.load(queue);
  return { sim, kb, queue };
}

describe("unlock and matrix commands", () => {
  it("encodes and decodes like vial.c", () => {
    expect(toHex(vialUnlockStart.encode())).toBe("fe06");
    expect(toHex(vialUnlockPoll.encode())).toBe("fe07");
    expect(toHex(vialLock.encode())).toBe("fe08");
    expect(vialUnlockPoll.decode(padTo(fromHex("000128"), 32))).toEqual({
      unlocked: false,
      inProgress: true,
      counter: 40,
    });
    expect(toHex(viaGetMatrixState.encode())).toBe("0203");
  });

  it("decodes matrix rows big-endian, bit n = column n", () => {
    // 2 rows x 10 columns: 2 bytes per row. Row 0: cols 0 and 9; row 1: col 8.
    const reply = padTo(fromHex("0203" + "0201" + "0100"), 32);
    const m = viaGetMatrixState.decode(reply, 2, 10)!;
    expect(m[0].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 9]);
    expect(m[1].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([8]);
    expect(viaGetMatrixState.decode(padTo(fromHex("ff03"), 32), 2, 10)).toBeNull();
  });

  it("knows which matrices fit one reply", () => {
    expect(matrixStateFits(8, 6)).toBe(true); // KLOR: 8 bytes
    expect(matrixStateFits(6, 16)).toBe(true); // Q10: 18 bytes
    expect(matrixStateFits(8, 24)).toBe(false); // 32 bytes
  });
});

describe("unlock flow", () => {
  it("unlocks while the keys are held and reports progress", async () => {
    const { sim, kb, queue } = await board();
    const fractions: number[] = [];
    let keys: { row: number; col: number }[] = [];
    sim.holdUnlockKeys();
    const ok = await runUnlock(queue, {
      pollIntervalMs: 0,
      onProgress: (p) => {
        keys = p.keys;
        fractions.push(p.fraction);
      },
    });
    expect(ok).toBe(true);
    expect(keys).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ]);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(await kb.isUnlocked()).toBe(true);
    expect(kb.unlocked).toBe(true);
  });

  it("cancels cleanly and leaves the queue usable", async () => {
    const { sim, kb, queue } = await board();
    const controller = new AbortController();
    let polls = 0;
    const done = runUnlock(queue, {
      pollIntervalMs: 0,
      signal: controller.signal,
      onProgress: () => {
        if (++polls === 3) controller.abort();
      },
    });
    expect(await done).toBe(false);
    expect(sim.unlocked).toBe(false);
    expect(sim.unlockInProgress).toBe(true); // the firmware has no cancel
    // Nothing is stuck: the next command goes straight through.
    expect(await kb.isUnlocked()).toBe(false);
    // Starting again resets the counter and can finish.
    sim.holdUnlockKeys();
    expect(await runUnlock(queue, { pollIntervalMs: 0 })).toBe(true);
  });

  it("routes operations that need an unlock through the handler, and locks again", async () => {
    const { sim, kb, queue } = await board();
    await expect(kb.setKey(0, 0, 0, 0x7c00)).rejects.toBeInstanceOf(UnlockRequiredError);

    kb.unlockHandler = async () => {
      sim.holdUnlockKeys();
      return runUnlock(queue, { pollIntervalMs: 0 });
    };
    await kb.setKey(0, 0, 0, 0x7c00);
    expect(sim.getKeycode(0, 0, 0)).toBe(0x7c00);

    await kb.lock();
    expect(sim.unlocked).toBe(false);
    expect(kb.unlocked).toBe(false);

    kb.unlockHandler = async () => false; // user cancelled
    await expect(kb.setKey(0, 0, 1, 0x7c00)).rejects.toBeInstanceOf(UnlockRequiredError);
  });

  it("polls the matrix only when unlocked", async () => {
    const { sim, kb, queue } = await board();
    expect(kb.matrixTesterSupported).toBe(true);
    expect(await kb.pollMatrix()).toBeNull();
    sim.holdUnlockKeys();
    await runUnlock(queue, { pollIntervalMs: 0 });
    sim.holdUnlockKeys(false);
    sim.pressed.add("1,1");
    expect(await kb.pollMatrix()).toEqual([
      [false, false],
      [false, true],
    ]);
  });

  it("has no matrix tester before Vial protocol 3", async () => {
    const { kb } = await board({ vialProtocol: 2 });
    expect(kb.matrixTesterSupported).toBe(false);
  });
});
