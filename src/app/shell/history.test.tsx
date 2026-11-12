// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Undo/Redo buttons, the Undo toast and Ctrl+Z against a simulated board.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { TopBar } from "./TopBar.tsx";
import { UndoToast } from "./UndoToast.tsx";
import { useHistory } from "./useHistory.ts";

afterEach(cleanup);

async function board() {
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
  return { sim, kb: await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 })) };
}

function Harness({ kb, errors }: { kb: Keyboard; errors: string[] }) {
  const history = useHistory(kb, (m) => errors.push(m));
  return (
    <>
      <TopBar
        keyboard={kb}
        history={history}
        showLog={false}
        onToggleLog={() => undefined}
        onExtensions={() => undefined}
        onDisconnect={() => undefined}
        onError={() => undefined}
      />
      <input aria-label="Text field" />
      <UndoToast keyboard={kb} controls={history} />
    </>
  );
}

describe("undo in the app", () => {
  it("shows a toast after a change and undoes from it, then redoes from the top bar", async () => {
    const { sim, kb } = await board();
    const errors: string[] = [];
    render(<Harness kb={kb} errors={errors} />);
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);

    await act(() => kb.setKey(0, 0, 0, 0x06));
    expect(screen.getByRole("status").textContent).toContain("Layer 0, key (0, 0): KC_A → KC_C");
    const topUndo = screen.getByRole("button", { name: /^Undo: Layer 0, key \(0, 0\)/ });
    expect(topUndo.hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Undo" })); // the toast's
    await waitFor(() => expect(sim.getKeycode(0, 0, 0)).toBe(0x04));
    expect(await screen.findByText(/Undid: Layer 0/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Redo: Layer 0/ }));
    await waitFor(() => expect(sim.getKeycode(0, 0, 0)).toBe(0x06));
    expect(errors).toEqual([]);
  });

  it("Ctrl+Z and Ctrl+Shift+Z work outside text fields only", async () => {
    const { sim, kb } = await board();
    render(<Harness kb={kb} errors={[]} />);
    await act(() => kb.setKey(0, 0, 0, 0x06));

    fireEvent.keyDown(screen.getByLabelText("Text field"), { key: "z", ctrlKey: true });
    expect(kb.history.canUndo).toBe(true); // the text field keeps its own undo

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(sim.getKeycode(0, 0, 0)).toBe(0x04));
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(sim.getKeycode(0, 0, 0)).toBe(0x06));
  });
});
