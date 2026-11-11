// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installCombos } from "../../core/sim/combos.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";
import { CombosPanel } from "./combosUi.tsx";

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
  });
  const combos = installCombos(sim, { count, entries: [[0x04, 0x16, 0, 0, 0x29]] });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, kb, combos };
}

describe("Combos panel", () => {
  it("shows a Combos tab in the editor with one row per combo", async () => {
    const { kb } = await setup();
    render(<Editor keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Combos" }));
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Combo 1", "Combo 2", "Combo 3"]);
    expect(screen.getByRole("button", { name: "Combo 1 key 1: KC_A" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Combo 1 output: KC_ESCAPE" })).toBeTruthy();
    expect(screen.getByText("KC_A + KC_S → KC_ESCAPE")).toBeTruthy();
  });

  it("assigns a picked keycode to the selected slot and moves to the next slot", async () => {
    const { kb, combos } = await setup();
    const onError = vi.fn();
    render(<CombosPanel keyboard={kb} onError={onError} onNotice={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Combo 2 key 1: KC_NO" }));
    expect(screen.getByRole("button", { name: "Combo 2 key 1: KC_NO" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    await waitFor(() => expect(combos.entries[1]).toEqual([0x14, 0, 0, 0, 0]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Combo 2 key 2: KC_NO" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Combo 2 output: KC_NO" }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LCTL(KC_C)" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(combos.entries[1]).toEqual([0x14, 0, 0, 0, 0x0106]));
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps a slot the user selected while a write was in flight", async () => {
    const { kb, combos } = await setup();
    render(<CombosPanel keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Combo 2 key 1: KC_NO" }));
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    // The write has not resolved yet; pick another combo's slot meanwhile.
    fireEvent.click(screen.getByRole("button", { name: "Combo 3 output: KC_NO" }));
    await waitFor(() => expect(combos.entries[1]).toEqual([0x14, 0, 0, 0, 0]));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Q" }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByRole("button", { name: "Combo 3 output: KC_NO" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Combo 2 key 2: KC_NO" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("clears a combo", async () => {
    const { kb, combos } = await setup();
    render(<CombosPanel keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    expect((screen.getByRole("button", { name: "Clear combo 2" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear combo 1" }));
    await waitFor(() => expect(combos.entries[0]).toEqual([0, 0, 0, 0, 0]));
    expect(screen.getAllByText("unused")).toHaveLength(3);
  });

  it("reports a refused unlock through onError", async () => {
    const { kb, combos } = await setup();
    const onError = vi.fn();
    render(<CombosPanel keyboard={kb} onError={onError} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Combo 1 output: KC_ESCAPE" }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "QK_BOOT" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toMatch(/^Combo 1: .*unlocked/);
    expect(combos.entries[0]).toEqual([0x04, 0x16, 0, 0, 0x29]);
  });
});
