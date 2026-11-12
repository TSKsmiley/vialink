// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { macrosExtension } from "../../core/extensions/macros.ts";
import { Keyboard } from "../../core/keyboard.ts";
import { installMacroSimulator } from "../../core/sim/macros.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { ExtensionsDialog } from "./ExtensionsDialog.tsx";

afterEach(cleanup);

function Harness({
  keyboard,
  onClose = () => undefined,
}: {
  keyboard: Keyboard | null;
  onClose?: () => void;
}) {
  const [disabled, setDisabled] = useState(new Set<string>());
  return (
    <ExtensionsDialog
      disabled={disabled}
      onChange={setDisabled}
      keyboard={keyboard}
      onError={() => undefined}
      onClose={onClose}
    />
  );
}

async function klor() {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
  });
  installMacroSimulator(sim, { count: 4, memory: 64 });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
}

describe("Extensions dialog", () => {
  it("links to the firmware an extension needs", () => {
    render(<Harness keyboard={null} />);
    const link = screen.getByRole("link", { name: "Theis194/vial-qmk" });
    expect(link.getAttribute("href")).toBe("https://github.com/Theis194/vial-qmk");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("turns an extension off and on again on the connected keyboard right away", async () => {
    const kb = await klor();
    render(<Harness keyboard={kb} />);
    const macros = screen.getByRole("checkbox", { name: "Macros" });
    expect(kb.extension(macrosExtension)).not.toBeNull();

    fireEvent.click(macros);
    await waitFor(() => expect(kb.extension(macrosExtension)).toBeNull());
    expect(screen.getAllByText("Turned off.")).toHaveLength(1);

    fireEvent.click(macros);
    await waitFor(() => expect(kb.extension(macrosExtension)).not.toBeNull());
    // The probe order is kept, as after a fresh connect.
    expect(kb.activeExtensions.map((a) => a.extension.id)).toEqual(["macros"]);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness keyboard={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
