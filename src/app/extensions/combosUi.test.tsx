// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installCombos } from "../../core/sim/combos.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";
import { ExtensionView } from "./ExtensionView.tsx";

afterEach(cleanup);

async function setup(count = 3) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    dynamic: { tapDance: 0, combo: count, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
    // Base layer: row 0 = A B C D E F.
    keymap: [[[0x04, 0x05, 0x06, 0x07, 0x08, 0x09]]],
  });
  const combos = installCombos(sim, { count, entries: [[0x04, 0x16, 0, 0, 0x29]] });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb, combos };
}

const detail = (n: number) => screen.getByRole("region", { name: `Combo ${n}` });
const baseKey = (col: number) =>
  within(screen.getByRole("group", { name: /^Base layer/ })).getAllByRole("button", {
    name: new RegExp(`^Key 0,${col}:`),
  })[0];
const choose = (label: string, text: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("Combos view", () => {
  it("lists the combos that are set up and shows one in detail", async () => {
    const { kb } = await setup();
    render(<Editor keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    fireEvent.click(
      within(screen.getByRole("tablist", { name: "Edit" })).getByRole("tab", { name: "Combos" }),
    );
    expect(screen.getByText("1 of 3 used")).toBeTruthy();
    expect(within(detail(1)).getByRole("heading", { name: "A + S sends Esc" })).toBeTruthy();
    expect(within(detail(1)).getByText("KC_A + KC_S → KC_ESCAPE")).toBeTruthy();
  });

  it("adds triggers from the keyboard, packed, and sets the output by search", async () => {
    const { kb, combos } = await setup();
    const onError = vi.fn();
    kb.notifyHandler = (kind, message) => kind === "error" && onError(message);
    render(<ExtensionView keyboard={kb} view="combos" />);
    fireEvent.click(screen.getByRole("button", { name: "New combo" }));
    fireEvent.click(baseKey(2)); // C
    await waitFor(() => expect(combos.entries[1]).toEqual([0x06, 0, 0, 0, 0]));
    fireEvent.click(baseKey(3)); // D
    await waitFor(() => expect(combos.entries[1]).toEqual([0x06, 0x07, 0, 0, 0]));
    // Removing the first keeps the rest at the front.
    fireEvent.click(baseKey(2));
    await waitFor(() => expect(combos.entries[1]).toEqual([0x07, 0, 0, 0, 0]));
    choose("Output key", "ctrl+c");
    await waitFor(() => expect(combos.entries[1]).toEqual([0x07, 0, 0, 0, 0x0106]));
    await kb.history.undo();
    expect(combos.entries[1]).toEqual([0x07, 0, 0, 0, 0]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("deletes a combo", async () => {
    const { kb, combos } = await setup();
    render(<ExtensionView keyboard={kb} view="combos" />);
    fireEvent.click(within(detail(1)).getByRole("button", { name: "Delete combo" }));
    await waitFor(() => expect(combos.entries[0]).toEqual([0, 0, 0, 0, 0]));
  });

  it("reports a refused unlock through onError", async () => {
    const { kb, combos } = await setup();
    const onError = vi.fn();
    kb.notifyHandler = (kind, message) => kind === "error" && onError(message);
    render(<ExtensionView keyboard={kb} view="combos" />);
    choose("Output key", "QK_BOOT");
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toMatch(/^Combo 1: .*unlocked/);
    expect(combos.entries[0]).toEqual([0x04, 0x16, 0, 0, 0x29]);
  });
});
