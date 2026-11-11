// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { IndexedDbLayoutStore, setLayoutStore } from "../storage/savedLayouts.ts";
import { VilControls } from "./VilControls.tsx";

beforeEach(() => setLayoutStore(new IndexedDbLayoutStore(new IDBFactory())));
afterEach(() => {
  cleanup();
  setLayoutStore(null);
});

async function setup() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    keymap: [[[0x04, 0x05]]],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  const onNotice = vi.fn();
  render(
    <VilControls
      keyboard={kb}
      busy={false}
      setBusy={() => undefined}
      onError={onError}
      onNotice={onNotice}
    />,
  );
  return { sim, kb, onError, onNotice };
}

describe("saving layouts in the browser", () => {
  it("saves, then restores the board from the saved copy", async () => {
    const { sim, kb, onError, onNotice } = await setup();

    fireEvent.click(screen.getByRole("button", { name: "Save in browser" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Daily" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(onNotice.mock.calls[0][0]).toContain("Daily");

    await kb.setKey(0, 0, 0, 0x14); // change KC_A to KC_Q after saving

    fireEvent.click(screen.getByRole("button", { name: "Saved layouts" }));
    const dialog = await screen.findByRole("dialog", { name: "Saved layouts" });
    expect(within(dialog).getByText("This keyboard")).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Load Daily" }));

    const confirm = await screen.findByRole("dialog", { name: "Load Daily?" });
    expect(within(confirm).getByText(/1 keys, encoders or layout options/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Write to keyboard" }));
    await waitFor(() => expect(sim.getKeycode(0, 0, 0)).toBe(0x04));
    expect(onError).not.toHaveBeenCalled();
  });

  it("renames and deletes saved layouts", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Save in browser" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Old name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Saved layouts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename Old name" }));
    fireEvent.change(screen.getByLabelText("New name for Old name"), { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await screen.findByText("New name");

    fireEvent.click(screen.getByRole("button", { name: "Delete New name" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete New name" }));
    await screen.findByText(/Nothing saved in this browser yet/);
  });
});
