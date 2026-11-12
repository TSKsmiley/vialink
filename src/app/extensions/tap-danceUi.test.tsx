// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../../core/sim/tap-dance.ts";
import type { TapDanceEntry } from "../../core/protocol/tap-dance.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";

afterEach(cleanup);

async function setup(tapDance = 3, entries: Partial<TapDanceEntry>[] = [{ onTap: 0x04 }]) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    dynamic: { tapDance, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  const td = installTapDanceSimulator(sim, { count: tapDance, entries });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={() => undefined} />);
  return { sim, td, kb, onError };
}

function openTab() {
  fireEvent.click(
    within(screen.getByRole("tablist", { name: "Edit" })).getByRole("tab", { name: "Tap dance" }),
  );
}
const detail = (n: number) => screen.getByRole("region", { name: `TD ${n}` });
const choose = (label: string, text: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("Tap dance view", () => {
  it("lists the tap dances that are set up and shows one in detail", async () => {
    await setup();
    openTab();
    const list = screen.getByRole("list", { name: "Tap dance entries" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining("TD 0")]);
    expect(within(list).getByText("Tap A")).toBeTruthy();
    expect(screen.getByText("1 of 3 used")).toBeTruthy();
    expect(within(detail(0)).getByRole("button", { name: "Tap: KC_A" })).toBeTruthy();
    expect(within(detail(0)).getByRole("button", { name: "Hold: not set" })).toBeTruthy();
    expect((within(detail(0)).getByLabelText("Tapping term") as HTMLInputElement).value).toBe("200");
  });

  it("is absent on boards without tap dance", async () => {
    await setup(0);
    expect(screen.queryByRole("tab", { name: "Tap dance" })).toBeNull();
  });

  it("writes each change at once: a new tap dance, its keys and its term", async () => {
    const { td, kb, onError } = await setup();
    openTab();
    fireEvent.click(screen.getByRole("button", { name: "New tap dance" }));
    // The new one opens on its Tap slot.
    choose("Tap: choose a key", "esc");
    await waitFor(() => expect(td.entries[1].onTap).toBe(0x29));
    fireEvent.click(within(detail(1)).getByRole("button", { name: "Hold: not set" }));
    choose("Hold: choose a key", "ctrl+c");
    await waitFor(() => expect(td.entries[1].onHold).toBe(kb.keycodes.parse("LCTL(KC_C)")));

    const term = within(detail(1)).getByLabelText("Tapping term");
    fireEvent.change(term, { target: { value: "250" } });
    fireEvent.blur(term);
    await waitFor(() => expect(td.entries[1].tappingTerm).toBe(250));
    expect(kb.history.nextUndo?.label).toBe("Tap dance TD 1");
    await kb.history.undo();
    expect(td.entries[1].tappingTerm).toBe(200);
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows a stored tapping term above 10000 as 10000, like vial-gui's QSpinBox", async () => {
    await setup(3, [{ onTap: 0x04, tappingTerm: 20000 }]);
    openTab();
    expect((within(detail(0)).getByLabelText("Tapping term") as HTMLInputElement).value).toBe("10000");
  });

  it("rejects invalid tapping terms without writing", async () => {
    const { td } = await setup();
    openTab();
    const term = within(detail(0)).getByLabelText("Tapping term");
    fireEvent.change(term, { target: { value: "10001" } });
    fireEvent.blur(term);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(td.entries[0].tappingTerm).toBe(200);
  });

  it("clears a tap dance", async () => {
    const { td } = await setup();
    openTab();
    fireEvent.click(within(detail(0)).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(td.entries[0].onTap).toBe(0));
  });

  it("reports a rejected write through onError", async () => {
    const { sim, onError } = await setup();
    sim.handlers.unshift((msg) => {
      if (msg[0] === 0xfe && msg[1] === 0x0d && msg[2] === 0x02) {
        msg[0] = 0xff;
        return true;
      }
      return false;
    });
    openTab();
    fireEvent.click(within(detail(0)).getByRole("button", { name: "Hold: not set" }));
    choose("Hold: choose a key", "b");
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith("TD 0: the keyboard rejected tap dance 0 (status 255)");
  });
});
