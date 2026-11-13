// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { KeyboardView } from "./KeyboardView.tsx";

afterEach(cleanup);

describe("keyboard view decorations", () => {
  it("draws an extension's mark as a dot and adds its words to the key", async () => {
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
    const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions: [] });
    const { container } = render(
      <KeyboardView
        keyboard={kb}
        layer={0}
        onSelect={() => undefined}
        mark={(row, col) => (row === 0 && col === 0 ? { dot: true, title: "has a note" } : null)}
      />,
    );
    expect(container.querySelectorAll("circle.key-mark")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Key 0,0: .*, has a note$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Key 0,1: [^,]*$/ })).toBeTruthy();
  });
});
