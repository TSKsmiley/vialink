// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Layer menu, paste preview and Ctrl+C / Ctrl+V on the keymap (redesign phase 3).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { KC_TRNS, visiblePositions } from "../../core/layerInfo.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function setup() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    layerNames: ["Base", "Nav", "Raise", ""],
    unlocked: true,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const [p, q] = visiblePositions(kb);
  // Nav: A on p, transparent elsewhere; Raise: B on p and q.
  for (const pos of kb.matrixPositions) await kb.setKey(1, pos.row, pos.col, KC_TRNS);
  await kb.setKey(1, p.row, p.col, 0x04);
  await kb.setKey(2, p.row, p.col, 0x05);
  await kb.setKey(2, q.row, q.col, 0x05);
  kb.history.clear();
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  return { sim, kb, p, q, onError };
}

async function menuItem(layerTitle: string, item: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: `Menu for ${layerTitle}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

describe("layer operations", () => {
  it("copies a layer and pastes it with a preview, as one undo step", async () => {
    const { sim, kb, p, q, onError } = await setup();
    await menuItem("Nav", "Copy layerCtrl+C");
    expect(screen.getByText("Copied")).toBeTruthy();
    await menuItem("Raise", /Paste onto this layer/);

    const options = screen.getByRole("complementary", { name: "Paste options" });
    expect(screen.getByRole("heading", { name: "Paste Nav onto Raise" })).toBeTruthy();
    // Default "Only where Nav has a key": only p changes (B → A); q keeps B.
    expect(within(options).getByRole("button", { name: "Paste 1 change" })).toBeTruthy();
    expect(
      screen.getAllByLabelText(new RegExp(`^Key ${p.row},${p.col}: KC_A \\(changed\\), was KC_B`)).length,
    ).toBe(1);

    fireEvent.click(within(options).getByLabelText(/Replace the whole layer/));
    fireEvent.click(within(options).getByRole("button", { name: /^Paste \d+ changes$/ }));
    await waitFor(() => expect(sim.getKeycode(2, q.row, q.col)).toBe(KC_TRNS));
    expect(sim.getKeycode(2, p.row, p.col)).toBe(0x04);
    expect(screen.queryByRole("complementary", { name: "Paste options" })).toBeNull();

    await kb.history.undo();
    expect(sim.getKeycode(2, p.row, p.col)).toBe(0x05);
    expect(sim.getKeycode(2, q.row, q.col)).toBe(0x05);
    expect(onError).not.toHaveBeenCalled();
  });

  it("Ctrl+C copies the selected keys and Ctrl+V pastes them onto the current layer", async () => {
    const { sim, p, q } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "2: Raise" }));
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^Key ${q.row},${q.col}:`) })[0]);
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    expect(screen.getByText("1 key from Raise")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "0: Base" }));
    fireEvent.paste(document.body, { clipboardData: { getData: () => "" } });
    const options = await screen.findByRole("complementary", { name: "Paste options" });
    fireEvent.click(within(options).getByRole("button", { name: /^Paste 1 change$/ }));
    await waitFor(() => expect(sim.getKeycode(0, q.row, q.col)).toBe(0x05));
    expect(sim.getKeycode(0, p.row, p.col)).toBe(0); // not part of the copy
  });

  it("clears and duplicates layers from the menu", async () => {
    const { sim, kb, p } = await setup();
    await menuItem("Raise", /Clear layer/);
    await waitFor(() => expect(sim.getKeycode(2, p.row, p.col)).toBe(KC_TRNS));
    expect(kb.history.nextUndo?.label).toBe("Clear Raise");

    await menuItem("Nav", "Duplicate to empty layer");
    // Layer 2 (Raise) is named, so the first empty one is 3; the view opens it.
    await waitFor(() => expect(sim.getKeycode(3, p.row, p.col)).toBe(0x04));
    expect(screen.getByRole("tab", { name: "3: Layer 3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shares a layer as text and pastes it back from Ctrl+V anywhere", async () => {
    const { sim, kb, p } = await setup();
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void (copied = t) },
    });
    await menuItem("Nav", /^Copy layer as text/);
    await waitFor(() => expect(copied).toMatch(/^vialink:layer:1:/));

    fireEvent.paste(document.body, { clipboardData: { getData: () => copied } });
    expect(await screen.findByText("Same keyboard.")).toBeTruthy();
    expect(screen.getByText("Same layout options.")).toBeTruthy();
    const options = screen.getByRole("complementary", { name: "Paste options" });
    // Defaults: the first empty, unnamed layer (3), replace the whole layer.
    expect((within(options).getByLabelText(/onto/) as HTMLSelectElement).value).toBe("3");
    fireEvent.click(within(options).getByRole("button", { name: /^Paste \d+ changes?$/ }));
    await waitFor(() => expect(sim.getKeycode(3, p.row, p.col)).toBe(0x04));
    expect(kb.history.nextUndo?.label).toMatch(/^Paste “Nav” from the text onto Layer 3/);
  });

  it("refuses text from another keyboard", async () => {
    await setup();
    fireEvent.paste(document.body, {
      clipboardData: { getData: () => "vialink:layer:1:klor:not-really" },
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("swaps two layers with their names, as one undo step", async () => {
    const { sim, kb, p } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Menu for Nav" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Swap with/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "2 · Raise" }));
    await waitFor(() => expect(sim.getKeycode(1, p.row, p.col)).toBe(0x05));
    expect(sim.getKeycode(2, p.row, p.col)).toBe(0x04);
    await waitFor(() => expect(sim.layerNames?.slice(1, 3)).toEqual(["Raise", "Nav"]));
    expect(kb.history.nextUndo?.label).toBe("Swap Nav and Raise");
    await kb.history.undo();
    expect(sim.layerNames?.slice(1, 3)).toEqual(["Nav", "Raise"]);
    expect(sim.getKeycode(1, p.row, p.col)).toBe(0x04);
  });
});
