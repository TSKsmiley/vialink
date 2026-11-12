// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installQmkSettings } from "../../core/sim/qmk-settings.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(cleanup);

async function setup(settings: Record<number, number> | null = { 2: 50, 7: 200, 21: 1, 22: 0 }) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
  });
  const fw = settings ? installQmkSettings(sim, settings, { 2: 50, 7: 200, 21: 0, 22: 0 }) : null;
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  const onNotice = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={onNotice} />);
  return { sim, fw, kb, onError, onNotice };
}

function openPanel() {
  fireEvent.click(screen.getByRole("tab", { name: "QMK settings" }));
}

describe("QMK settings panel", () => {
  it("is a tab only on boards with settings", async () => {
    await setup(null);
    expect(screen.queryByRole("tab", { name: "QMK settings" })).toBeNull();
  });

  it("shows the board's settings grouped in qmk_settings.json tabs", async () => {
    await setup();
    openPanel();
    const groups = screen.getByRole("tablist", { name: "QMK settings groups" });
    expect([...groups.querySelectorAll("[role=tab]")].map((t) => t.textContent)).toEqual([
      "Magic",
      "Tap-Hold",
      "Combo",
    ]);
    expect((screen.getByLabelText("Swap Caps Lock and Left Control") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Swap Left Alt and GUI") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Tap-Hold" }));
    expect((screen.getByLabelText("Tapping Term") as HTMLInputElement).value).toBe("200");
    expect(screen.getByLabelText("Permissive Hold")).toBeTruthy();
    expect(screen.queryByLabelText("Quick Tap Term")).toBeNull(); // qsid 25 not on this board
  });

  it("writes a toggled bit and a committed number to the board", async () => {
    const { fw, onError } = await setup();
    openPanel();
    fireEvent.click(screen.getByLabelText("Swap Left Alt and GUI"));
    await waitFor(() => expect(fw!.values.get(21)).toBe(0b101));
    await waitFor(() =>
      expect((screen.getByLabelText("Swap Left Alt and GUI") as HTMLInputElement).checked).toBe(true),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Tap-Hold" }));
    const term = screen.getByLabelText("Tapping Term") as HTMLInputElement;
    fireEvent.change(term, { target: { value: "20000" } });
    expect(term.getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(term, { key: "Enter" });
    fireEvent.blur(term);
    expect(fw!.values.get(7)).toBe(200);

    fireEvent.change(term, { target: { value: "180" } });
    fireEvent.keyDown(term, { key: "Enter" });
    fireEvent.blur(term);
    await waitFor(() => expect(fw!.values.get(7)).toBe(180));
    expect(onError).not.toHaveBeenCalled();
  });

  it("asks before resetting, then shows the defaults", async () => {
    const { fw, onNotice } = await setup({ 2: 30, 7: 300, 21: 1, 22: 1 });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fw!.values.get(7)).toBe(300);

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults…" }));
    expect(screen.getByText("Reset all settings to default values?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(Object.fromEntries(fw!.values)).toEqual({ 2: 50, 7: 200, 21: 0, 22: 0 });
    expect((screen.getByLabelText("Swap Caps Lock and Left Control") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Tap-Hold" }));
    expect((screen.getByLabelText("Tapping Term") as HTMLInputElement).value).toBe("200");
  });

  it("reports a refused write through onError", async () => {
    const { sim, onError } = await setup();
    sim.handlers.unshift((msg) => {
      if (msg[0] !== 0xfe || msg[1] !== 0x0b) return false;
      msg[0] = 0xff;
      return true;
    });
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Combo" }));
    const combo = screen.getByLabelText("Time out period for combos") as HTMLInputElement;
    fireEvent.change(combo, { target: { value: "70" } });
    fireEvent.blur(combo);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/rejected/)));
    await waitFor(() => expect(combo.value).toBe("50"));
  });
});
