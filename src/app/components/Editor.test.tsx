// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "./Editor.tsx";

afterEach(cleanup);

async function setup() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    layerNames: ["Base", "Nav", "", ""],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  return { sim, kb, onError };
}

describe("Editor", () => {
  it("assigns a picked keycode to the selected key and moves to the next key", async () => {
    const { sim, kb } = await setup();
    const first = [...kb.keys].sort((a, b) => a.y - b.y || a.x - b.x)[0];

    fireEvent.click(
      screen.getAllByRole("button", { name: new RegExp(`^Key ${first.row},${first.col}:`) })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Q" }));

    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x14));
    // Selection advanced: the picker reports the next key's code, not KC_Q.
    await waitFor(() => expect(screen.getByText(/Selected key:/).textContent).not.toContain("KC_Q"));
  });

  it("fills the inner key of a masked keycode and accepts typed expressions", async () => {
    const { sim, kb, onError } = await setup();
    const k = kb.keys[0];
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^Key ${k.row},${k.col}:`) })[0]);

    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LSFT(KC_NO)" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(0x0200));

    // The key stays selected after a masked pick; a basic keycode becomes its inner key.
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(0x0204));

    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LT(9" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows layer names and switches layers", async () => {
    await setup();
    const tab = screen.getByRole("tab", { name: "1: Nav" });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("group", { name: "Layer 1 keymap" })).toBeTruthy();
  });

  it("writes layout options and re-renders the view", async () => {
    const { sim, kb } = await setup();
    const before = screen.getAllByRole("button", { name: /^Key / }).length;
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    await waitFor(() => expect(sim.layoutOptions).toBe(2));
    expect(kb.layoutChoices).toEqual([2]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Key / }).length).not.toBe(before));
  });

  it("builds layer keys in two steps, with layer names, keeping an LT key's tap key", async () => {
    const { sim, kb, onError } = await setup();
    const k = kb.keys[0];
    const selectKey = () =>
      fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^Key ${k.row},${k.col}:`) })[0]);

    selectKey();
    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
    fireEvent.click(screen.getByLabelText(/^Toggle/));
    fireEvent.click(screen.getByRole("button", { name: "Toggle: layer 1 (Nav)" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("TG(1)")));

    // LT: choose the layer, then the picker moves to Basic for the tap key.
    selectKey();
    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
    expect(screen.getByRole("button", { name: "Toggle: layer 1 (Nav)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByLabelText(/^Hold, or tap for a key/));
    fireEvent.click(screen.getByRole("button", { name: "Hold, or tap for a key: layer 2" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("LT(2, KC_NO)")));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("LT(2, KC_A)")));

    // Moving it to another layer keeps the tap key.
    selectKey();
    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Hold, or tap for a key: layer 1 (Nav)" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("LT(1, KC_A)")));
    expect(onError).not.toHaveBeenCalled();
  });
});
