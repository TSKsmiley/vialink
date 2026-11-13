// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The keymap view: layer rail, keyboard and key inspector (redesign phase 2).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { visiblePositions } from "../../core/layerInfo.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "./Editor.tsx";

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
    layerNames: ["Base", "Nav", "", ""],
    unlocked: true,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  const [first, second, third] = visiblePositions(kb);
  return { sim, kb, onError, first, second, third };
}

const keyButton = (p: { row: number; col: number }) =>
  screen.getAllByRole("button", { name: new RegExp(`^Key ${p.row},${p.col}:`) })[0];
const inspector = () => screen.getByRole("complementary", { name: "Selected key" });
const search = (label: string, text: string) => {
  const box = within(inspector()).getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("keymap", () => {
  it("assigns a key by search and stays on it unless auto-advance is ticked", async () => {
    const { sim, first, second } = await setup();
    fireEvent.click(keyButton(first));
    expect(within(inspector()).getByText(`Key at row ${first.row}, column ${first.col} · Base`)).toBeTruthy();

    search("Replace with any key", "q");
    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x14));
    expect(within(inspector()).getByText(`Key at row ${first.row}, column ${first.col} · Base`)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Move to the next key after assigning"));
    search("Replace with any key", "w");
    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x1a));
    expect(
      await within(inspector()).findByText(`Key at row ${second.row}, column ${second.col} · Base`),
    ).toBeTruthy();
    // Recent keys offer what was just used.
    expect(
      within(screen.getByText("Recent:").parentElement!).getByRole("button", { name: "W" }),
    ).toBeTruthy();
  });

  it("keeps vial-gui's inner-key fill and typed expressions under All keys", async () => {
    const { sim, first, onError } = await setup();
    fireEvent.click(keyButton(first));
    fireEvent.click(within(inspector()).getByRole("tab", { name: "All keys" }));

    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LSFT(KC_NO)" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x0200));

    // A masked key opens on Key + mods; the full picker is still one tab away.
    fireEvent.click(within(inspector()).getByRole("tab", { name: "All keys" }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x0204));

    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LT(9" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it("lists layers with names and how they are reached, and switches layers", async () => {
    const { kb, first } = await setup();
    await kb.setKey(0, first.row, first.col, kb.keycodes.parse("LT(1, KC_SPACE)"));
    const nav = await screen.findByRole("tab", { name: "1: Nav" });
    expect(nav.getAttribute("aria-description")).toMatch(/hold Space/);
    // Of the empty, unnamed, unreached layers only the first shows, as a ghost card.
    expect(screen.getByRole("tab", { name: "2: Layer 2" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "3: Layer 3" })).toBeNull();
    // Opening the ghost starts naming it; Escape leaves it empty and adds nothing.
    fireEvent.click(screen.getByRole("tab", { name: "2: Layer 2" }));
    fireEvent.keyDown(await screen.findByLabelText("Name for layer 2"), { key: "Escape" });
    expect(screen.queryByRole("tab", { name: "3: Layer 3" })).toBeNull();
    // Naming it makes it a real layer, and the next empty one becomes the ghost.
    fireEvent.click(screen.getByRole("tab", { name: "2: Layer 2" }));
    const ghostBox = await screen.findByLabelText("Name for layer 2");
    fireEvent.change(ghostBox, { target: { value: "Sym" } });
    fireEvent.submit(ghostBox.closest("form")!);
    expect(await screen.findByRole("tab", { name: "3: Layer 3" })).toBeTruthy();
    // Undoing the name makes layer 2 empty again, so layer 3 goes away.
    await act(() => kb.history.undo());
    expect(screen.queryByRole("tab", { name: "3: Layer 3" })).toBeNull();
    fireEvent.click(nav);
    expect(nav.getAttribute("aria-selected")).toBe("true");
    // The pen after the name edits it in place.
    fireEvent.click(screen.getByRole("button", { name: "Rename Nav" }));
    const box = screen.getByLabelText("Name for layer 1");
    fireEvent.change(box, { target: { value: "Arrows" } });
    fireEvent.submit(box.closest("form")!);
    expect(await screen.findByRole("tab", { name: "1: Arrows" })).toBeTruthy();
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

  it("builds a layer key from When held and When tapped", async () => {
    const { sim, kb, first, onError } = await setup();
    const code = () => sim.getKeycode(0, first.row, first.col);
    fireEvent.click(keyButton(first));
    fireEvent.click(within(inspector()).getByRole("tab", { name: "Layer" }));

    fireEvent.click(screen.getByRole("button", { name: "Hold for layer 1: Nav" }));
    await waitFor(() => expect(code()).toBe(kb.keycodes.parse("MO(1)")));
    search("Tap key", "a");
    await waitFor(() => expect(code()).toBe(kb.keycodes.parse("LT(1, KC_A)")));
    expect(within(inspector()).getByText("A, or Nav while held")).toBeTruthy();

    // Another layer keeps the tap key.
    fireEvent.click(screen.getByRole("button", { name: "Hold for layer 2: Layer 2" }));
    await waitFor(() => expect(code()).toBe(kb.keycodes.parse("LT(2, KC_A)")));

    // The other layer actions are still there.
    fireEvent.click(screen.getByText(/Other layer behaviours/));
    fireEvent.click(screen.getByLabelText(/^Toggle/));
    fireEvent.click(screen.getByRole("button", { name: "Toggle: layer 1 (Nav)" }));
    await waitFor(() => expect(code()).toBe(kb.keycodes.parse("TG(1)")));
    expect(onError).not.toHaveBeenCalled();
  });

  it("adds modifiers to a key", async () => {
    const { sim, kb, first } = await setup();
    fireEvent.click(keyButton(first));
    fireEvent.click(within(inspector()).getByRole("tab", { name: "Key + mods" }));
    search("Key", "c");
    await waitFor(() => expect(sim.getKeycode(0, first.row, first.col)).toBe(0x06));
    fireEvent.click(screen.getByLabelText("Ctrl"));
    await waitFor(() =>
      expect(sim.getKeycode(0, first.row, first.col)).toBe(kb.keycodes.parse("LCTL(KC_C)")),
    );
    fireEvent.click(screen.getByLabelText("Shift"));
    await waitFor(() =>
      expect(sim.getKeycode(0, first.row, first.col)).toBe(kb.keycodes.parse("LCTL(LSFT(KC_C))")),
    );
    expect(within(inspector()).getByText("Ctrl + Shift + C")).toBeTruthy();
  });

  it("sets several shift-clicked keys as one undo step", async () => {
    const { sim, kb, first, second, third } = await setup();
    fireEvent.click(keyButton(first));
    fireEvent.click(keyButton(second), { shiftKey: true });
    fireEvent.click(keyButton(third), { shiftKey: true });
    expect(within(inspector()).getByText("3 keys selected · Base")).toBeTruthy();
    search("Replace with any key", "esc");
    await waitFor(() => expect(sim.getKeycode(0, third.row, third.col)).toBe(0x29));
    expect(sim.getKeycode(0, first.row, first.col)).toBe(0x29);
    expect(kb.history.nextUndo?.writes.length).toBe(3);
    await kb.history.undo();
    expect(sim.getKeycode(0, second.row, second.col)).toBe(0);
  });

  it("shows what a transparent key falls through to", async () => {
    const { kb, first } = await setup();
    await kb.setKey(0, first.row, first.col, 0x04);
    await kb.setKey(1, first.row, first.col, kb.keycodes.parse("KC_TRNS"));
    fireEvent.click(screen.getByRole("tab", { name: "1: Nav" }));
    expect(keyButton(first).getAttribute("aria-label")).toContain("shows KC_A from below");
    // The toggle shows only this layer: the key is plain transparent again.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show keys from layers below" }));
    expect(keyButton(first).getAttribute("aria-label")).not.toContain("from below");
    expect(keyButton(first).textContent).toContain("▽");
  });
});
