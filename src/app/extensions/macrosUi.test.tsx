// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Component tests for the Macros tab, after vial-gui's editor/macro_recorder.py
// and macro/macro_tab.py on top of protocol/macro.py.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installMacroSimulator } from "../../core/sim/macros.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(cleanup);

async function setup({ count = 3, memory = 64, contents = new Uint8Array(0), unlocked = true } = {}) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    unlocked,
  });
  const macros = installMacroSimulator(sim, { count, memory, contents });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  const onNotice = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={onNotice} />);
  fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
  return { sim, macros, kb, onError, onNotice };
}

// M0 = text "hi", M1 = tap KC_A (protocol 6: SS_QMK_PREFIX, SS_TAP_CODE, 0x04), M2 empty.
const TWO_MACROS = Uint8Array.of(0x68, 0x69, 0, 1, 1, 4, 0, 0);

describe("Macros panel", () => {
  it("has no tab on boards without macro memory", async () => {
    const sim = new SimulatedKeyboard({
      compressedDefinition: new Uint8Array(
        readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
      ),
      rows: 8,
      cols: 6,
      layers: 4,
    });
    await sim.open();
    const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
    render(<Editor keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    expect(screen.queryByRole("tab", { name: "Macros" })).toBeNull();
  });

  it("shows one tab per macro and the board's actions", async () => {
    await setup({ contents: TWO_MACROS });
    const tabs = within(screen.getByRole("tablist", { name: "Macros" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["M0", "M1", "M2"]);
    expect((screen.getByLabelText("Action 1 text") as HTMLInputElement).value).toBe("hi");
    expect(screen.getByRole("status").textContent).toContain("Memory used by macros: 8/64");

    fireEvent.click(tabs[1]);
    expect((screen.getByLabelText("Action 1 type") as HTMLSelectElement).value).toBe("tap");
    expect((screen.getByLabelText("Action 1 key 1") as HTMLInputElement).value).toBe("KC_A");
  });

  it("marks edited macros and writes them on Save", async () => {
    const { macros, onError, onNotice } = await setup({ contents: TWO_MACROS });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "M2" }));
    fireEvent.click(screen.getByRole("button", { name: "Tap Enter" }));
    expect(screen.getByRole("tab", { name: "M2*" })).toBeTruthy();
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Macros saved to the keyboard."));
    expect(onError).not.toHaveBeenCalled();
    // KC_ENTER = 0x28 after the two existing macros.
    expect([...macros.buffer.slice(0, 11)]).toEqual([0x68, 0x69, 0, 1, 1, 4, 0, 1, 1, 0x28, 0]);
    expect(screen.getByRole("tab", { name: "M2" })).toBeTruthy();
  });

  it("blocks Save on invalid keycodes, delays and non-ASCII text", async () => {
    await setup({ contents: TWO_MACROS });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText("Action 1 text"), { target: { value: "héllo" } });
    expect(screen.getByText(/Only plain ASCII/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Action 1 text"), { target: { value: "hello" } });
    expect(save.disabled).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "M1" }));
    fireEvent.change(screen.getByLabelText("Action 1 key 1"), { target: { value: "KC_NOPE" } });
    expect(screen.getByLabelText("Action 1 key 1").getAttribute("aria-invalid")).toBe("true");
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Action 1 key 1"), { target: { value: "KC_B" } });

    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    fireEvent.change(screen.getByLabelText("Action 2 type"), { target: { value: "delay" } });
    fireEvent.change(screen.getByLabelText("Action 2 delay (ms)"), { target: { value: "70000" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Action 2 delay (ms)"), { target: { value: "100" } });
    expect(save.disabled).toBe(false);
  });

  it("disables Save when the macros do not fit in memory", async () => {
    await setup({ memory: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    fireEvent.change(screen.getByLabelText("Action 1 text"), { target: { value: "too long text" } });
    expect(screen.getByRole("status").textContent).toContain("16/8");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Revert discards edits", async () => {
    await setup({ contents: TWO_MACROS });
    fireEvent.change(screen.getByLabelText("Action 1 text"), { target: { value: "bye" } });
    expect(screen.getByRole("tab", { name: "M0*" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Action 1 text") as HTMLInputElement).value).toBe("hi"),
    );
    expect(screen.getByRole("tab", { name: "M0" })).toBeTruthy();
  });

  it("reports an error when the board is locked and no unlock is possible", async () => {
    const { macros, onError } = await setup({ contents: TWO_MACROS, unlocked: false });
    fireEvent.change(screen.getByLabelText("Action 1 text"), { target: { value: "bye" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(macros.writes).toBe(0);
  });
});
