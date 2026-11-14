// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The lock state in the top bar: Locked/Unlocked buttons, and no Lock button
// on VIAL_INSECURE firmware (which ignores it).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { TopBar } from "./TopBar.tsx";
import { useHistory } from "./useHistory.ts";

afterEach(cleanup);

async function setup(unlockKeys?: { row: number; col: number }[], unlocked?: boolean) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/test_2x2_encoder.vial.json.xz")),
    ),
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    unlockKeys,
    unlocked,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  function Harness() {
    const history = useHistory(kb, () => undefined);
    return (
      <TopBar
        keyboard={kb}
        history={history}
        showLog={false}
        onToggleLog={() => undefined}
        onExtensions={() => undefined}
        onDisconnect={() => undefined}
        onError={() => undefined}
      />
    );
  }
  render(<Harness />);
  return { sim, kb };
}

describe("lock state in the top bar", () => {
  it("locks an unlocked board", async () => {
    const { sim } = await setup(undefined, true);
    fireEvent.click(await screen.findByRole("button", { name: "Unlocked" }));
    await screen.findByRole("button", { name: "Locked" });
    expect(sim.unlocked).toBe(false);
  });

  it("says a VIAL_INSECURE board is always unlocked and offers no Lock", async () => {
    await setup([]);
    const label = await screen.findByText("Always unlocked");
    expect(label.closest("[title]")?.getAttribute("title")).toMatch(/VIAL_INSECURE/);
    expect(screen.queryByRole("button", { name: "Unlocked" })).toBeNull();
  });
});
