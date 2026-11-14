// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
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

  it("still unlocks under StrictMode, which runs its effect twice", async () => {
    const { sim, kb } = await setup();
    const onFinish = vi.fn();
    render(
      <StrictMode>
        <UnlockDialog keyboard={kb} reason="Test" onFinish={onFinish} pollIntervalMs={1} />
      </StrictMode>,
    );
    await waitFor(() => expect(sim.unlockInProgress).toBe(true));
    expect(onFinish).not.toHaveBeenCalled();
    act(() => sim.holdUnlockKeys());
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(true));
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
  const unlockedBoard = async () => {
    const { sim, kb } = await setup();
    sim.unlocked = true;
    await kb.isUnlocked();
    return { sim, kb };
  };
  const captureSwitch = () => screen.getByRole("switch", { name: "Capture keys" });

  it("asks for an unlock, then shows held and tested keys and the progress", async () => {
    const { sim, kb } = await setup();
    kb.unlockHandler = async () => {
      sim.unlocked = true;
      kb.setUnlocked(true);
      return true;
    };
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
    await screen.findByText("0 of 4 tested");
    expect(screen.getByRole("progressbar", { name: "Keys tested" }).getAttribute("aria-valuenow")).toBe("0");

    sim.pressed.add("1,0");
    await waitFor(() => expect(screen.getByLabelText(/^Key 1,0: .*\(held\)/)).toBeTruthy());
    sim.pressed.delete("1,0");
    await waitFor(() => expect(screen.getByLabelText(/^Key 1,0: .*\(tested\)/)).toBeTruthy());
    expect(screen.getByText("1 of 4 tested")).toBeTruthy();
    expect(screen.getByText("3 to go")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await screen.findByText("0 of 4 tested");
  });

  it("lists the keys not tested yet and the recent presses with their place in the matrix", async () => {
    const { sim, kb } = await unlockedBoard();
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);
    const untested = await screen.findByRole("region", { name: "Not tested yet" });
    expect(within(untested).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Nothing pressed yet.")).toBeTruthy();

    sim.pressed.add("0,1");
    const recent = screen.getByRole("region", { name: "Recent presses" });
    await waitFor(() => expect(within(recent).getByText("held now")).toBeTruthy());
    expect(within(recent).getByText("row 0 · col 1")).toBeTruthy();
    sim.pressed.delete("0,1");
    await waitFor(() => expect(within(recent).getByText(/^\d+ ms$/)).toBeTruthy());
    expect(within(untested).getAllByRole("listitem")).toHaveLength(3);
    expect(within(untested).queryByTitle("Row 0, column 1")).toBeNull();
  });

  it("stops polling and asks again when the board gets locked", async () => {
    const { sim, kb } = await unlockedBoard();
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);
    await screen.findByText(/of 4 tested/);
    sim.unlocked = false;
    await screen.findByRole("button", { name: "Unlock" });
    expect(kb.unlocked).toBe(false);
  });

  it("keeps key presses away from the page while testing, unless switched off", async () => {
    const { kb } = await unlockedBoard();
    const pageKeys = vi.fn();
    window.addEventListener("keydown", pageKeys);
    try {
      render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);
      await screen.findByText("Your keys only reach the tester");
      expect(fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })).toBe(false);
      expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(false);
      expect(pageKeys).not.toHaveBeenCalled();

      expect(captureSwitch().getAttribute("aria-checked")).toBe("true");
      fireEvent.click(captureSwitch());
      await screen.findByText("Keys also reach the page");
      expect(captureSwitch().getAttribute("aria-checked")).toBe("false");
      expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(true);
      expect(pageKeys).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", pageKeys);
    }
  });

  it("lets keys through once Esc is held, but not when it is tapped", async () => {
    const { kb } = await unlockedBoard();
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} releaseHoldMs={30} />);
    await screen.findByText("Your keys only reach the tester");

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyUp(document.body, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 60));
    expect(captureSwitch().getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    await screen.findByText("Keys also reach the page");
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(true);
  });

  it("captures system keys in full screen, and leaves it when Esc is held", async () => {
    const { kb } = await unlockedBoard();
    const lock = vi.fn(async () => undefined);
    const unlock = vi.fn();
    let fullscreenElement: Element | null = null;
    const setFullscreen = (el: Element | null) => {
      fullscreenElement = el;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    Object.defineProperty(navigator, "keyboard", { value: { lock, unlock }, configurable: true });
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
    Object.defineProperty(document, "fullscreenElement", {
      get: () => fullscreenElement,
      configurable: true,
    });
    document.exitFullscreen = vi.fn(async () => setFullscreen(null));
    Element.prototype.requestFullscreen = vi.fn(async function (this: Element) {
      setFullscreen(this);
    });
    try {
      render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} releaseHoldMs={20} />);
      fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
      await screen.findByRole("button", { name: "Exit full screen" });
      expect(lock).toHaveBeenCalledWith();
      expect(fullscreenElement).toBe(screen.getByRole("region", { name: "Matrix tester" }));
      expect(screen.getByText("Full screen: every key reaches only the tester")).toBeTruthy();

      fireEvent.keyDown(document.body, { key: "Escape" });
      await screen.findByText("Keys also reach the page");
      expect(fullscreenElement).toBeNull();
      expect(unlock).toHaveBeenCalled();
    } finally {
      for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
        delete (document as unknown as Record<string, unknown>)[key];
      }
      delete (navigator as unknown as Record<string, unknown>).keyboard;
      delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
    }
  });

  it("doesn't capture keys while the board is locked", async () => {
    const { kb } = await setup();
    render(<MatrixTester keyboard={kb} onError={() => undefined} intervalMs={1} />);
    await screen.findByRole("button", { name: "Unlock" });
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(true);
  });
});
