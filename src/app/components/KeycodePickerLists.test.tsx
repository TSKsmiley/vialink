// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The picker's Layers and Tap Dance tabs on a board with many of both: only
// layers in use (or named) and tap dances that are set up get buttons.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../../core/sim/tap-dance.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "./Editor.tsx";

afterEach(cleanup);

async function setup() {
  const letters = Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => 0x04));
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 8,
    // Layer 0 has keys, layer 2 has one key; layers 1 (named), 3-7 are empty.
    keymap: [letters, [], [[], [0, 0x05]]],
    layerNames: ["Base", "Nav", "", "", "", "", "", ""],
    dynamic: { tapDance: 8, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  installTapDanceSimulator(sim, { count: 8, entries: [{ onTap: 0x29, onHold: 0x39 }] });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  const k = kb.keys[0];
  fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^Key ${k.row},${k.col}:`) })[0]);
  return { sim, kb, k, onError };
}

describe("keycode picker lists", () => {
  it("shows used and named layers as buttons and the rest in a dropdown", async () => {
    const { sim, kb, k } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
    const targets = screen.getByRole("group", { name: "2. Which layer?" });
    const buttons = within(targets)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Hold: layer 0 (Base)", "Hold: layer 1 (Nav)", "Hold: layer 2"]);

    const more = screen.getByRole("combobox", { name: "Other layer" });
    expect(
      within(more)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Other layer…",
      "Layer 3 (empty)",
      "Layer 4 (empty)",
      "Layer 5 (empty)",
      "Layer 6 (empty)",
      "Layer 7 (empty)",
    ]);
    fireEvent.change(more, { target: { value: "5" } });
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("MO(5)")));
  });

  it("lists tap dances that are set up, with what they do, and offers a new one", async () => {
    const { sim, kb, k } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Tap Dance" }));
    const td0 = screen.getByRole("button", { name: /^TD 0/ });
    expect(td0.textContent).toMatch(/Tap Esc.*Hold Caps/);
    expect(screen.queryByRole("button", { name: /^TD 1/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New tap dance (TD 1)" }));
    await waitFor(() => expect(sim.getKeycode(0, k.row, k.col)).toBe(kb.keycodes.parse("TD(1)")));
  });
});
