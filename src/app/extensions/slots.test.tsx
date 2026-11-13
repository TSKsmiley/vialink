// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeviceContext, KeyboardExtension } from "../../core/extensions/types.ts";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { ExtensionOverlays, ExtensionSlot } from "./ExtensionSlot.tsx";
import { APP_EXTENSIONS, keyInspectorTabs, slots, type AppExtension } from "./registry.tsx";

afterEach(cleanup);

let ctx: DeviceContext | null = null;
const notes: KeyboardExtension<{ notes: Record<string, string> }> = {
  id: "key-notes",
  name: "Key notes",
  description: "",
  group: "compatible",
  probe: async (c) => ((ctx = c as DeviceContext), { notes: { "0,0": "Esc on tap" } }),
};
const notesUi: AppExtension = {
  id: "key-notes",
  slots: slots<{ notes: Record<string, string> }>({
    "keyInspector.tab": {
      title: "Note",
      Component: ({ state, keys }) => (
        <p>{keys.map((k) => state.notes[`${k.row},${k.col}`] ?? "no note").join()}</p>
      ),
    },
    "devicePanel.section": {
      title: "Notes stats",
      Component: ({ state }) => <p>{Object.keys(state.notes).length} notes</p>,
    },
    "topBar.item": {
      Component: () => {
        throw new Error("boom");
      },
    },
  }),
};

beforeEach(() => {
  (APP_EXTENSIONS as AppExtension[]).push(notesUi);
  return () => void (APP_EXTENSIONS as AppExtension[]).pop();
});

async function board() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: [notes as KeyboardExtension<unknown>],
  });
}

describe("extension slots", () => {
  it("draw each running extension's components, a crash only in its own place", async () => {
    const kb = await board();
    render(
      <div>
        <ExtensionSlot keyboard={kb} name="devicePanel.section" headings />
        <ExtensionSlot keyboard={kb} name="topBar.item" />
      </div>,
    );
    expect(screen.getByRole("region", { name: "Notes stats" }).textContent).toContain("1 notes");
    expect(screen.getByRole("alert").textContent).toContain("Key notes failed to draw");

    const [tab] = keyInspectorTabs(kb);
    expect(tab.title).toBe("Note");
    render(tab.render({ layer: 0, keys: [{ row: 0, col: 0 }], current: null }));
    expect(screen.getByText("Esc on tap")).toBeTruthy();
  });

  it("show overlays under their anchor until closed", async () => {
    const kb = await board();
    render(
      <div>
        <section data-anchor="keymap.layerRail">Layers</section>
        <ExtensionOverlays keyboard={kb} />
      </div>,
    );
    ctx!.ui.overlay({ anchor: "keymap.layerRail", title: "Your layers", body: "Click one to edit it." });
    ctx!.ui.overlay({ anchor: "nowhere", title: "Hidden" });
    const shown = await screen.findByRole("dialog", { name: "Your layers" });
    expect(shown.textContent).toContain("Click one to edit it.");
    expect(screen.queryByRole("dialog", { name: "Hidden" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Your layers" })).toBeNull();
  });
});
