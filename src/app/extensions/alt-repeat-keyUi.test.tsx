// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Alt repeat key panel", () => {
  it("has no tab on boards without alt repeat keys", async () => {
    await setup(0);
    expect(screen.queryByRole("tab", { name: "Alt Repeat Key" })).toBeNull();
  });

  it("shows one tab per entry with the board's values", async () => {
    await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Alt Repeat Key" }));
    const entries = screen.getByRole("tablist", { name: "Alt repeat key entries" });
    expect(entries.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect((screen.getByLabelText("Enable") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Last key for alt repeat key 1: KC_E" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alt key for alt repeat key 1: KC_R" })).toBeTruthy();
  });

  it("writes checkbox and keycode changes through to the board", async () => {
    const { arep } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Alt Repeat Key" }));
    fireEvent.click(screen.getByRole("tab", { name: "2" }));

    fireEvent.click(screen.getByLabelText("Enable"));
    await waitFor(() => expect(arep.entries[1].options).toBe(0x08));
    fireEvent.click(screen.getByLabelText("RShift"));
    await waitFor(() => expect(arep.entries[1].allowedMods).toBe(1 << 5));
    fireEvent.click(screen.getByLabelText("Bidirectional"));
    await waitFor(() => expect(arep.entries[1].options).toBe(0x0a));

    fireEvent.click(screen.getByRole("button", { name: /^Last key for alt repeat key 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await waitFor(() => expect(arep.entries[1].keycode).toBe(0x04));

    fireEvent.click(screen.getByRole("button", { name: /^Alt key for alt repeat key 2/ }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LSFT(KC_B)" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(arep.entries[1].altKeycode).toBe(0x0205));
    // Entry 1 was left alone.
    expect(arep.entries[0]).toEqual({ keycode: 0x08, altKeycode: 0x15, allowedMods: 0, options: 0x08 });
  });

  it("reports errors, e.g. QK_BOOT on a locked board", async () => {
    const { arep, onError } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Alt Repeat Key" }));
    fireEvent.click(screen.getByRole("button", { name: /^Alt key for alt repeat key 1/ }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "QK_BOOT" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/unlocked/)));
    expect(arep.entries[0].altKeycode).toBe(0x15);
  });
});
