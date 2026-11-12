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
  return screen.getByRole("region", { name: "Tap dance" });
}

describe("Tap dance panel", () => {
  it("shows one card per TD(n) with the stored entry", async () => {
    await setup();
    const panel = openTab();
    const cards = within(panel).getAllByRole("form");
    expect(cards.map((c) => c.getAttribute("aria-labelledby"))).toHaveLength(3);
    const first = within(panel).getByRole("form", { name: "TD(0)" });
    expect((within(first).getByLabelText("On tap") as HTMLInputElement).value).toBe("KC_A");
    expect((within(first).getByLabelText("On hold") as HTMLInputElement).value).toBe("KC_NO");
    expect((within(first).getByLabelText("Tapping term (ms)") as HTMLInputElement).value).toBe("200");
  });

  it("is absent on boards without tap dance", async () => {
    await setup(0);
    expect(screen.queryByRole("tab", { name: "Tap dance" })).toBeNull();
  });

  it("writes an edited entry on save", async () => {
    const { td, onError } = await setup();
    const card = within(openTab()).getByRole("form", { name: "TD(1)" });
    const save = within(card).getByRole("button", { name: "Save TD(1)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(within(card).getByLabelText("On tap"), { target: { value: "LCTL(KC_C)" } });
    fireEvent.change(within(card).getByLabelText("On hold"), { target: { value: "MO(1)" } });
    fireEvent.change(within(card).getByLabelText("Tapping term (ms)"), { target: { value: "180" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(td.entries[1]).toEqual({
        onTap: 0x0106,
        onHold: 0x5221,
        onDoubleTap: 0,
        onTapHold: 0,
        tappingTerm: 180,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
    const after = screen.getByRole("form", { name: "TD(1)" });
    await waitFor(() =>
      expect((within(after).getByRole("button", { name: "Save TD(1)" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
  });

  it("clamps a stored tapping term above 10000 like vial-gui's QSpinBox and lets the card save", async () => {
    const { td, onError } = await setup(1, [{ onTap: 0x04, tappingTerm: 15000 }]);
    const card = within(openTab()).getByRole("form", { name: /^TD\(0\)/ });
    expect((within(card).getByLabelText("Tapping term (ms)") as HTMLInputElement).value).toBe("10000");
    expect(within(card).getByText("(modified)")).toBeTruthy();

    fireEvent.change(within(card).getByLabelText("On hold"), { target: { value: "KC_LCTL" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save TD(0)" }));
    await waitFor(() =>
      expect(td.entries[0]).toMatchObject({ onTap: 0x04, onHold: 0xe0, tappingTerm: 10000 }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects invalid keycodes and tapping terms without writing", async () => {
    const { sim } = await setup();
    const card = within(openTab()).getByRole("form", { name: "TD(0)" });
    fireEvent.change(within(card).getByLabelText("On double tap"), { target: { value: "KC_NOPE" } });
    fireEvent.change(within(card).getByLabelText("Tapping term (ms)"), { target: { value: "20000" } });
    const sent = sim.requests.length;
    fireEvent.click(within(card).getByRole("button", { name: "Save TD(0)" }));
    expect(await within(card).findAllByRole("alert")).toHaveLength(2);
    expect(within(card).getByLabelText("On double tap").getAttribute("aria-invalid")).toBe("true");
    expect(sim.requests.length).toBe(sent);

    fireEvent.click(within(card).getByRole("button", { name: "Revert TD(0)" }));
    expect((within(card).getByLabelText("On double tap") as HTMLInputElement).value).toBe("KC_NO");
    expect(within(card).queryAllByRole("alert")).toHaveLength(0);
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
    const card = within(openTab()).getByRole("form", { name: "TD(2)" });
    fireEvent.change(within(card).getByLabelText("On tap"), { target: { value: "KC_B" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save TD(2)" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("the keyboard rejected tap dance 2 (status 255)"),
    );
  });
});
