// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { macrosExtension } from "../../core/extensions/macros.ts";
import type { KeyboardExtension } from "../../core/extensions/types.ts";
import { Keyboard } from "../../core/keyboard.ts";
import { installMacroSimulator } from "../../core/sim/macros.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { ExtensionsDialog } from "./ExtensionsDialog.tsx";

afterEach(cleanup);

function Harness({
  keyboard,
  onClose = () => undefined,
  extensions,
  initiallyOff = [],
}: {
  keyboard: Keyboard | null;
  onClose?: () => void;
  extensions?: readonly KeyboardExtension<unknown>[];
  initiallyOff?: string[];
}) {
  const [disabled, setDisabled] = useState(new Set<string>(initiallyOff));
  return (
    <ExtensionsDialog
      disabled={disabled}
      onChange={setDisabled}
      keyboard={keyboard}
      onError={(message) => {
        throw new Error(message);
      }}
      onClose={onClose}
      extensions={extensions}
    />
  );
}

/** A fake extension the keyboard supports unless `supported` is false. */
const fake = (
  id: string,
  name: string,
  manifest: Partial<Pick<KeyboardExtension, "requires" | "conflicts">> = {},
  supported = true,
): KeyboardExtension<unknown> => ({
  id,
  name,
  description: "",
  group: "compatible",
  ...manifest,
  probe: async () => (supported ? {} : null),
});

async function klor(extensions?: readonly KeyboardExtension<unknown>[]) {
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
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions });
}

describe("Extensions dialog", () => {
  it("lists standard Vial features apart from non-standard extensions", () => {
    render(<Harness keyboard={null} />);
    const standard = screen.getByRole("group", { name: "Standard Vial" });
    const other = screen.getByRole("group", { name: "Non-standard Vial" });
    expect(standard.hasAttribute("open")).toBe(false); // folded at first
    expect(within(standard).getByText("6 of 6 on")).toBeTruthy();
    for (const name of [
      "Macros",
      "Tap dance",
      "Combos",
      "Key overrides",
      "Alt repeat keys",
      "QMK settings",
    ]) {
      expect(within(standard).getByRole("checkbox", { name })).toBeTruthy();
    }
    expect(within(other).getByRole("checkbox", { name: "Layer names" })).toBeTruthy();
    expect(within(other).queryByRole("checkbox", { name: "Macros" })).toBeNull();
  });

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
    expect(kb.activeExtensions.map((a) => a.extension.id)).toEqual(["macros", "layer-sharing"]);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness keyboard={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  describe("dependencies", () => {
    const sharing = fake("sharing", "Layer sharing");
    const whole = fake("whole", "Share whole keymap", { requires: ["sharing"] });
    const macros = fake("macros", "Macros");
    const recorder = fake("recorder", "Macro recorder", { conflicts: ["macros"] });
    const all = [sharing, whole, macros, recorder];
    const ids = (kb: Keyboard) => kb.activeExtensions.map((a) => a.extension.id);
    const question = () => screen.getByRole("alertdialog", { name: "Turn extensions on or off" });

    it("shows what a switched-off requirement keeps off, without a keyboard", () => {
      render(<Harness keyboard={null} extensions={all} initiallyOff={["sharing"]} />);
      expect(screen.getByText("Needs Layer sharing.")).toBeTruthy();
    });

    it("offers to turn a requirement on too, and No changes nothing", async () => {
      const kb = await klor([macros]);
      render(<Harness keyboard={kb} extensions={all} initiallyOff={["sharing", "whole", "recorder"]} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Share whole keymap" }));
      await waitFor(() =>
        expect(question().textContent).toContain(
          "Share whole keymap needs Layer sharing. Turn Layer sharing on too?",
        ),
      );
      fireEvent.click(within(question()).getByRole("button", { name: "No" }));
      expect((screen.getByRole("checkbox", { name: "Share whole keymap" }) as HTMLInputElement).checked).toBe(
        false,
      );

      fireEvent.click(screen.getByRole("checkbox", { name: "Share whole keymap" }));
      await waitFor(() => question());
      fireEvent.click(within(question()).getByRole("button", { name: "Yes" }));
      await waitFor(() => expect(ids(kb)).toEqual(["macros", "sharing", "whole"]));
      expect(screen.getAllByText("Active on this keyboard.")).toHaveLength(3);
    });

    it("asks before turning off what needs the extension turned off", async () => {
      const kb = await klor([sharing, whole]);
      render(<Harness keyboard={kb} extensions={all} initiallyOff={["macros", "recorder"]} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Layer sharing" }));
      await waitFor(() =>
        expect(question().textContent).toContain(
          "Share whole keymap needs Layer sharing. Turn Share whole keymap off too?",
        ),
      );
      fireEvent.click(within(question()).getByRole("button", { name: "Yes" }));
      await waitFor(() => expect(ids(kb)).toEqual([]));
      expect(screen.getAllByText("Turned off.")).toHaveLength(4);
    });

    it("asks to turn a running conflicting extension off", async () => {
      const kb = await klor([macros]);
      render(<Harness keyboard={kb} extensions={all} initiallyOff={["sharing", "whole", "recorder"]} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Macro recorder" }));
      await waitFor(() =>
        expect(question().textContent).toContain("Macro recorder doesn't work with Macros. Turn Macros off?"),
      );
      fireEvent.click(within(question()).getByRole("button", { name: "Yes" }));
      await waitFor(() => expect(ids(kb)).toEqual(["recorder"]));
      expect((screen.getByRole("checkbox", { name: "Macros" }) as HTMLInputElement).checked).toBe(false);
    });

    it("doesn't ask when the conflicting extension doesn't run on this keyboard", async () => {
      const unsupportedMacros = fake("macros", "Macros", {}, false);
      const exts = [sharing, whole, unsupportedMacros, recorder];
      const kb = await klor([unsupportedMacros]);
      render(<Harness keyboard={kb} extensions={exts} initiallyOff={["sharing", "whole", "recorder"]} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Macro recorder" }));
      await waitFor(() => expect(ids(kb)).toEqual(["recorder"]));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect((screen.getByRole("checkbox", { name: "Macros" }) as HTMLInputElement).checked).toBe(true);
    });

    it("says which conflicting extension runs instead", async () => {
      const kb = await klor([macros, recorder]);
      render(<Harness keyboard={kb} extensions={all} initiallyOff={["sharing", "whole"]} />);
      expect(screen.getByText("Not running: doesn't work with Macros, which is on.")).toBeTruthy();
    });
  });
});
