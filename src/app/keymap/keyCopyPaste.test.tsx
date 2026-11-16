// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Selecting several keys (Ctrl/⌘+click, Shift+click for a block) and copying
// keys onto other keys, on any layer (KeymapView, core/keyPaste.ts).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { keysBetween } from "../../core/keyPaste.ts";
import { visiblePositions } from "../../core/layerInfo.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const KC_A = 0x04;
const KC_B = 0x05;
const KC_C = 0x06;

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
  const order = visiblePositions(kb);
  const [p, q, r] = order;
  await kb.setKey(2, p.row, p.col, KC_B); // Raise: B on p
  kb.history.clear();
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => void copied.push(t) },
  });
  const onNotice = vi.fn();
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={onNotice} />);
  return { sim, kb, order, p, q, r, copied, onNotice, onError };
}

const keyButton = (p: { row: number; col: number }) =>
  screen.getAllByRole("button", { name: new RegExp(`^Key ${p.row},${p.col}:`) })[0];
const inspector = () => screen.getByRole("complementary", { name: "Selected key" });
const ctrl = (key: string) => fireEvent.keyDown(document.body, { key, ctrlKey: true });
const paste = (text = "") => fireEvent.paste(document.body, { clipboardData: { getData: () => text } });

describe("selecting several keys", () => {
  it("adds and removes keys with Ctrl+click", async () => {
    const { p, q, r } = await setup();
    fireEvent.click(keyButton(p));
    fireEvent.click(keyButton(q), { ctrlKey: true });
    fireEvent.click(keyButton(r), { metaKey: true }); // ⌘ on a Mac
    expect(within(inspector()).getByText("3 keys selected · Base")).toBeTruthy();
    fireEvent.click(keyButton(q), { ctrlKey: true });
    expect(within(inspector()).getByText("2 keys selected · Base")).toBeTruthy();
    // A plain click starts over with one key.
    fireEvent.click(keyButton(q));
    expect(within(inspector()).getByText(`Key at row ${q.row}, column ${q.col} · Base`)).toBeTruthy();
  });

  it("selects the block up to a Shift+clicked key", async () => {
    const { kb, order } = await setup();
    const a = order[0];
    const b = order[order.length - 1];
    const block = keysBetween(kb, { kind: "key", ...a }, { kind: "key", ...b });
    expect(block.length).toBeGreaterThan(2);
    fireEvent.click(keyButton(a));
    fireEvent.click(keyButton(b), { shiftKey: true });
    expect(within(inspector()).getByText(`${block.length} keys selected · Base`)).toBeTruthy();
  });
});

describe("copying and pasting keys", () => {
  it("copies a key and pastes it onto another key on another layer", async () => {
    const { sim, kb, p, q, copied, onError } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "2: Raise" }));
    fireEvent.click(keyButton(p));
    ctrl("c");
    await waitFor(() => expect(copied).toEqual(["KC_B"]));

    fireEvent.click(screen.getByRole("tab", { name: "0: Base" }));
    fireEvent.click(keyButton(q));
    paste("KC_B"); // the system clipboard holds our own copy
    await waitFor(() => expect(sim.getKeycode(0, q.row, q.col)).toBe(KC_B));
    expect(sim.getKeycode(0, p.row, p.col)).not.toBe(KC_B); // pasted where selected, not where copied
    expect(kb.history.nextUndo?.label).toBe("Paste KC_B on Base");
    await kb.history.undo();
    expect(sim.getKeycode(0, q.row, q.col)).not.toBe(KC_B);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fills every selected key with one copied key, as one undo step", async () => {
    const { sim, kb, p, q, r } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "2: Raise" }));
    fireEvent.click(keyButton(p));
    ctrl("c");
    fireEvent.click(screen.getByRole("tab", { name: "1: Nav" }));
    fireEvent.click(keyButton(q));
    fireEvent.click(keyButton(r), { ctrlKey: true });
    paste();
    await waitFor(() => expect(sim.getKeycode(1, r.row, r.col)).toBe(KC_B));
    expect(sim.getKeycode(1, q.row, q.col)).toBe(KC_B);
    expect(kb.history.nextUndo?.writes.length).toBe(2);
  });

  it("pastes keycode text copied elsewhere onto the selected keys", async () => {
    const { sim, kb, q, r } = await setup();
    fireEvent.click(keyButton(q));
    fireEvent.click(keyButton(r), { ctrlKey: true });
    paste("KC_A KC_C");
    await waitFor(() => expect(sim.getKeycode(0, r.row, r.col)).toBe(KC_C));
    expect(sim.getKeycode(0, q.row, q.col)).toBe(KC_A);
    expect(kb.history.nextUndo?.label).toBe("Paste 2 keys on Base");
  });

  it("has Copy and Paste buttons in the key panel", async () => {
    const { sim, p, q } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "2: Raise" }));
    fireEvent.click(keyButton(p));
    const pasteButton = () => within(inspector()).getByRole("button", { name: "Paste" }) as HTMLButtonElement;
    expect(pasteButton().disabled).toBe(true);
    fireEvent.click(within(inspector()).getByRole("button", { name: "Copy" }));
    fireEvent.click(keyButton(q));
    expect(pasteButton().disabled).toBe(false);
    fireEvent.click(pasteButton());
    await waitFor(() => expect(sim.getKeycode(2, q.row, q.col)).toBe(KC_B));
  });

  it("says what to do when nothing is copied", async () => {
    const { q, onNotice } = await setup();
    fireEvent.click(keyButton(q));
    paste("not keys");
    expect(onNotice).toHaveBeenCalledWith(
      "Nothing to paste: select keys and press Ctrl+C to copy them first.",
    );
  });
});
