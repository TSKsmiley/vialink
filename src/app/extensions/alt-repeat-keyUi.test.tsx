// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Component tests for the alt repeat key tab, after vial-gui's
// editor/alt_repeat_key.py on top of protocol/alt_repeat_key.py.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installAltRepeatKey } from "../../core/sim/alt-repeat-key.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(cleanup);

async function setup(count = 3) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    dynamic: { tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: count, featureFlags: 0 },
  });
  const arep = installAltRepeatKey(sim, {
    count,
    entries: [{ keycode: 0x08, altKeycode: 0x15, allowedMods: 0, options: 0x08 }],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  return { sim, arep, kb, onError };
}

const open = () => fireEvent.click(screen.getByRole("tab", { name: "Alt repeat key" }));
const detail = (n: number) => within(screen.getByRole("region", { name: `Alt repeat key ${n}` }));
const choose = (label: string, text: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("Alt repeat key panel", () => {
  it("has no tab on boards without alt repeat keys", async () => {
    await setup(0);
    expect(screen.queryByRole("tab", { name: "Alt repeat key" })).toBeNull();
  });

  it("lists the pairs in use and shows one with the board's values", async () => {
    await setup();
    open();
    expect(screen.getByText("1 of 3 used")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Alt repeat key entries" });
    expect(within(list).getByRole("button", { name: /Pair 1/ }).textContent).toContain("E → R");
    expect(detail(1).getByRole("heading", { name: "After E, Alt Repeat sends R" })).toBeTruthy();
    expect(detail(1).getByRole("switch", { name: "Enabled" }).getAttribute("aria-checked")).toBe("true");
    expect(detail(1).getByRole("button", { name: "Last key for alt repeat key 1: KC_E" })).toBeTruthy();
    expect(detail(1).getByRole("button", { name: "Alt key for alt repeat key 1: KC_R" })).toBeTruthy();
  });

  it("writes changes through to the board", async () => {
    const { arep } = await setup();
    open();
    fireEvent.click(screen.getByRole("button", { name: "New pair" }));
    const card = detail(2);
    choose("Last key: choose a key", "a");
    await waitFor(() => expect(arep.entries[1].keycode).toBe(0x04));

    fireEvent.click(card.getByRole("switch", { name: "Enabled" }));
    await waitFor(() => expect(arep.entries[1].options).toBe(0x08));
    fireEvent.click(card.getByRole("button", { name: "RShift" }));
    await waitFor(() => expect(arep.entries[1].allowedMods).toBe(1 << 5));
    fireEvent.click(card.getByLabelText("Bidirectional"));
    await waitFor(() => expect(arep.entries[1].options).toBe(0x0a));

    fireEvent.click(card.getByRole("button", { name: /^Alt key for alt repeat key 2/ }));
    choose("Alt key: choose a key", "LSFT(KC_B)");
    await waitFor(() => expect(arep.entries[1].altKeycode).toBe(0x0205));
    // Entry 1 was left alone.
    expect(arep.entries[0]).toEqual({ keycode: 0x08, altKeycode: 0x15, allowedMods: 0, options: 0x08 });
  });

  it("reports errors, e.g. QK_BOOT on a locked board", async () => {
    const { arep, onError } = await setup();
    open();
    fireEvent.click(detail(1).getByRole("button", { name: /^Alt key for alt repeat key 1/ }));
    choose("Alt key: choose a key", "QK_BOOT");
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/unlocked/)));
    expect(arep.entries[0].altKeycode).toBe(0x15);
  });
});
