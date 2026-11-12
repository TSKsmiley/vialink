// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { MatrixTester } from "./MatrixTester.tsx";
import { UnlockDialog } from "./UnlockDialog.tsx";

afterEach(cleanup);

async function setup() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb };
}

describe("UnlockDialog", () => {
  it("highlights the unlock keys and finishes once they are held", async () => {
    const { sim, kb } = await setup();
    const onFinish = vi.fn();
    render(<UnlockDialog keyboard={kb} reason="Assigning QK_BOOT" onFinish={onFinish} pollIntervalMs={1} />);

    await waitFor(() => expect(screen.getByLabelText(/^Key 0,0: .*\(target\)/)).toBeTruthy());
    expect(screen.getByLabelText(/^Key 0,1: .*\(target\)/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Key 1,0: .*\(target\)/)).toBeNull();

    act(() => sim.holdUnlockKeys());
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(true));
    expect(kb.unlocked).toBe(true);
  });

  it("cancels without leaving requests running", async () => {
    const { sim, kb } = await setup();
    const onFinish = vi.fn();
    render(<UnlockDialog keyboard={kb} reason="Test" onFinish={onFinish} pollIntervalMs={1} />);
    await waitFor(() => expect(sim.unlockInProgress).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onFinish).toHaveBeenCalledWith(false);
    const before = sim.requests.length;
    await new Promise((r) => setTimeout(r, 30));
    // At most the poll already in flight completes; no new polling starts.
    expect(sim.requests.length - before).toBeLessThanOrEqual(1);
    expect(await kb.isUnlocked()).toBe(false);
  });
});

describe("MatrixTester", () => {
  it("asks for an unlock, then shows pressed and tested keys", async () => {
    const { sim, kb } = await setup();
    kb.unlockHandler = async () => {
      sim.unlocked = true;
      kb.setUnlocked(true);
      return true;
    };
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
    await screen.findByText(/Tested: 0\/4/);

    sim.pressed.add("1,0");
    await waitFor(() => expect(screen.getByLabelText(/^Key 1,0: .*\(pressed\)/)).toBeTruthy());
    sim.pressed.delete("1,0");
    await waitFor(() => expect(screen.getByLabelText(/^Key 1,0: .*\(seen\)/)).toBeTruthy());
    expect(screen.getByText(/Tested: 1\/4/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await screen.findByText(/Tested: 0\/4/);
  });

  it("stops polling and asks again when the board gets locked", async () => {
    const { sim, kb } = await setup();
    sim.unlocked = true;
    await kb.isUnlocked();
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);
    await screen.findByText(/Tested:/);
    sim.unlocked = false;
    await screen.findByRole("button", { name: "Unlock" });
    expect(kb.unlocked).toBe(false);
  });
});
