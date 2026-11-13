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

describe("key overrides panel", () => {
  it("adds a Key overrides tab to the editor only when the board has them", async () => {
    const { kb } = await setup();
    render(<Editor keyboard={kb} onError={() => undefined} onNotice={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Key overrides" }));
    expect(screen.getAllByRole("region", { name: /^Key override \d$/ })).toHaveLength(2);
    cleanup();

    const none = await setup(0);
    render(<Editor keyboard={none.kb} onError={() => undefined} onNotice={() => undefined} />);
    expect(screen.queryByRole("tab", { name: "Key overrides" })).toBeNull();
  });

  it("writes checkbox changes for enable, layers, mods and options", async () => {
    const { kb, store } = await setup();
    const { onError } = renderPanel(kb);
    const card = within(screen.getByRole("region", { name: "Key override 1" }));

    const enabled = card.getByRole("checkbox", { name: "Enabled" }) as HTMLInputElement;
    expect(enabled.checked).toBe(true);
    fireEvent.click(enabled);
    await waitFor(() => expect(store.get(0).options & KO_ENABLED).toBe(0));
    expect(enabled.checked).toBe(false);

    fireEvent.click(card.getByRole("checkbox", { name: "Layer 2" }));
    await waitFor(() => expect(store.get(0).layers).toBe(0xfffb));
    fireEvent.click(card.getByRole("button", { name: "Disable all" }));
    await waitFor(() => expect(store.get(0).layers).toBe(0));

    const trigger = within(card.getByRole("group", { name: "Trigger mods" }));
    fireEvent.click(trigger.getByRole("checkbox", { name: "LShift" }));
    fireEvent.click(trigger.getByRole("checkbox", { name: "RGui" }));
    await waitFor(() => expect(store.get(0).triggerMods).toBe(0x82));
    const suppressed = within(card.getByRole("group", { name: "Suppressed mods" }));
    fireEvent.click(suppressed.getByRole("checkbox", { name: "LCtrl" }));
    await waitFor(() => expect(store.get(0).suppressedMods).toBe(0x01));
    const negative = within(card.getByRole("group", { name: "Negative mods" }));
    fireEvent.click(negative.getByRole("checkbox", { name: "RAlt" }));
    await waitFor(() => expect(store.get(0).negativeModMask).toBe(0x40));

    fireEvent.click(card.getByRole("checkbox", { name: "Activate on one modifier" }));
    await waitFor(() => expect(store.get(0).options).toBe(KO_OPTION_ONE_MOD));
    expect(onError).not.toHaveBeenCalled();
  });

  it("assigns trigger and replacement keycodes from the picker", async () => {
    const { kb, store } = await setup();
    renderPanel(kb);
    const card = within(screen.getByRole("region", { name: "Key override 2" }));

    fireEvent.click(card.getByRole("button", { name: /^Trigger of key override 2:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    await waitFor(() => expect(store.get(1).trigger).toBe(0x14));

    fireEvent.click(card.getByRole("button", { name: /^Replacement of key override 2:/ }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "LSFT(KC_1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(store.get(1).replacement).toBe(0x021e));
    expect(card.getByRole("button", { name: "Replacement of key override 2: LSFT(KC_1)" })).toBeTruthy();
  });

  it("reports a refused unlock through onError", async () => {
    const { kb, store } = await setup();
    const { onError } = renderPanel(kb);
    const card = within(screen.getByRole("region", { name: "Key override 1" }));
    fireEvent.click(card.getByRole("button", { name: /^Replacement of key override 1:/ }));
    fireEvent.change(screen.getByLabelText("Any"), { target: { value: "QK_BOOT" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/unlocked/)));
    expect(store.get(0).replacement).toBe(0x05);
  });
});
