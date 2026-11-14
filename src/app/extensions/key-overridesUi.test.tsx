// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { KO_ENABLED, KO_OPTION_ONE_MOD } from "../../core/protocol/key-overrides.ts";
import { defaultKeyOverride, installKeyOverrides } from "../../core/sim/key-overrides.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { ExtensionView } from "./ExtensionView.tsx";
import { Editor } from "../components/Editor.tsx";
import { keyOverridesUi } from "./key-overridesUi.tsx";

afterEach(cleanup);

const definition = () =>
  new Uint8Array(readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")));

async function setup(keyOverride = 2) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: definition(),
    rows: 8,
    cols: 6,
    layers: 4,
    dynamic: { tapDance: 0, combo: 0, keyOverride, altRepeatKey: 0, featureFlags: 0 },
  });
  const store = installKeyOverrides(sim, {
    count: keyOverride,
    entries: [{ ...defaultKeyOverride(), trigger: 0x04, replacement: 0x05, options: KO_ENABLED }],
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  return { sim, store, kb };
}

function renderPanel(kb: Keyboard) {
  const onError = vi.fn();
  kb.notifyHandler = (kind, message) => kind === "error" && onError(message);
  render(<ExtensionView keyboard={kb} view={keyOverridesUi.panels![0].id} />);
  return { onError };
}

const choose = (label: string, text: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};
const detail = (n: number) => within(screen.getByRole("region", { name: `Key override ${n}` }));

describe("key overrides panel", () => {
  it("adds a Key overrides tab to the editor only when the board has them", async () => {
    const { kb } = await setup();
    render(<Editor keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Key overrides" }));
    expect(screen.getByText("1 of 2 used")).toBeTruthy();
    expect(detail(1).getByRole("heading", { name: "A sends B" })).toBeTruthy();
    cleanup();

    const none = await setup(0);
    render(<Editor keyboard={none.kb} onError={() => undefined} onNotice={() => undefined} />);
    expect(screen.queryByRole("tab", { name: "Key overrides" })).toBeNull();
  });

  it("writes changes for enable, layers, mods and options", async () => {
    const { kb, store } = await setup();
    const { onError } = renderPanel(kb);
    const card = detail(1);

    const enabled = card.getByRole("switch", { name: "Enabled" });
    expect(enabled.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(enabled);
    await waitFor(() => expect(store.get(0).options & KO_ENABLED).toBe(0));
    await waitFor(() => expect(enabled.getAttribute("aria-checked")).toBe("false"));

    // Only this board's 4 layers are shown; the other bits stay as they are.
    expect(card.queryByRole("button", { name: "Layer 4" })).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "Layer 2" }));
    await waitFor(() => expect(store.get(0).layers).toBe(0xfffb));
    fireEvent.click(card.getByRole("button", { name: "None" }));
    await waitFor(() => expect(store.get(0).layers).toBe(0));
    fireEvent.click(card.getByRole("button", { name: "All layers" }));
    await waitFor(() => expect(store.get(0).layers).toBe(0xffff));

    const trigger = within(card.getByRole("group", { name: "Trigger mods" }));
    fireEvent.click(trigger.getByRole("button", { name: "LShift" }));
    await waitFor(() => expect(store.get(0).triggerMods).toBe(0x02));
    fireEvent.click(trigger.getByRole("button", { name: "RGui" }));
    await waitFor(() => expect(store.get(0).triggerMods).toBe(0x82));
    expect(card.getByRole("heading", { name: "Shift + Right GUI + A sends B" })).toBeTruthy();
    const suppressed = within(card.getByRole("group", { name: "Suppressed mods" }));
    fireEvent.click(suppressed.getByRole("button", { name: "LCtrl" }));
    await waitFor(() => expect(store.get(0).suppressedMods).toBe(0x01));
    const negative = within(card.getByRole("group", { name: "Negative mods" }));
    fireEvent.click(negative.getByRole("button", { name: "RAlt" }));
    await waitFor(() => expect(store.get(0).negativeModMask).toBe(0x40));

    fireEvent.click(card.getByRole("checkbox", { name: "Activate on one modifier" }));
    await waitFor(() => expect(store.get(0).options).toBe(KO_OPTION_ONE_MOD));
    expect(onError).not.toHaveBeenCalled();
  });

  it("sets up a new override by choosing its trigger and replacement keys", async () => {
    const { kb, store } = await setup();
    renderPanel(kb);
    fireEvent.click(screen.getByRole("button", { name: "New key override" }));
    const card = detail(2);
    // New opens on the trigger slot.
    choose("Trigger: choose a key", "q");
    await waitFor(() => expect(store.get(1).trigger).toBe(0x14));

    fireEvent.click(card.getByRole("button", { name: /^Replacement of key override 2:/ }));
    choose("Replacement: choose a key", "LSFT(KC_1)");
    await waitFor(() => expect(store.get(1).replacement).toBe(0x021e));
    expect(card.getByRole("button", { name: "Replacement of key override 2: LSFT(KC_1)" })).toBeTruthy();

    fireEvent.click(card.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(store.get(1).trigger).toBe(0));
    expect(store.get(1).replacement).toBe(0);
  });

  it("reports a refused unlock through onError", async () => {
    const { kb, store } = await setup();
    const { onError } = renderPanel(kb);
    fireEvent.click(detail(1).getByRole("button", { name: /^Replacement of key override 1:/ }));
    choose("Replacement: choose a key", "QK_BOOT");
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/unlocked/)));
    expect(store.get(0).replacement).toBe(0x05);
  });
});
