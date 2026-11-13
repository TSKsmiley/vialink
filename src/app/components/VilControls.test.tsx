// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { saveVialink } from "../../core/vialink.ts";
import { VilControls } from "./VilControls.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function board(layerNames: string[] = ["Base", "Nav"]) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    layerNames,
  });
  await sim.open();
  sim.unlocked = true;
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: BUILTIN_EXTENSIONS,
  });
  return { sim, kb };
}

function setup(kb: Keyboard) {
  const onNotice = vi.fn();
  const onError = vi.fn();
  render(
    <VilControls
      keyboard={kb}
      busy={false}
      setBusy={() => undefined}
      onError={onError}
      onNotice={onNotice}
    />,
  );
  return { onNotice, onError };
}

describe("Layouts menu", () => {
  it("exports pure Vial and says what stays behind", async () => {
    const { kb } = await board();
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => (blobs.push(b as Blob), "blob:x"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { onNotice } = setup(kb);
    fireEvent.click(screen.getByRole("button", { name: /Layouts/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export to Vial (.vil)" }));
    expect(await blobs[0].text()).not.toContain("layer_names");
    expect(onNotice).toHaveBeenCalledWith(
      "Layer names data isn't included in .vil files. Save a layout file to keep it.",
    );
  });

  it("loads a dropped .vialink file after asking, including extensions' data", async () => {
    const { sim, kb } = await board();
    const text = saveVialink(kb, { app: "t" }).replace('"Nav"', '"Symbols"');
    setup(kb);
    const file = new File([text], "daily.vialink");
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });
    const dialog = await screen.findByRole("dialog", { name: "Load daily.vialink?" });
    expect(dialog.textContent).toContain('Rename layer 1 to "Symbols"');
    fireEvent.click(screen.getByRole("button", { name: "Write to keyboard" }));
    await waitFor(() => expect(sim.layerNames).toEqual(["Base", "Symbols"]));
  });
});
