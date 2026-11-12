// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../../core/sim/tap-dance.ts";
import { tapDanceExtension } from "../../core/extensions/tap-dance.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { DevicePanel } from "./DevicePanel.tsx";

afterEach(cleanup);

async function setup() {
  const sim = new SimulatedKeyboard({
    info: { productName: "Klor", vendorId: 0x3a3c, productId: 0x0001 },
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    dynamic: { tapDance: 2, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  installTapDanceSimulator(sim, { count: 2 });
  await sim.open();
  const queue = new RequestQueue(sim, { retryDelayMs: 0 });
  const kb = await Keyboard.load(queue);
  render(<DevicePanel queue={queue} keyboard={kb} onClose={() => undefined} />);
  return { sim, kb };
}

const log = () => screen.getByRole("list", { name: "HID messages" });

describe("device panel", () => {
  it("shows the device and names each message with its result", async () => {
    const { kb } = await setup();
    const panel = screen.getByRole("complementary", { name: "Device and HID log" });
    expect(within(panel).getByText("3a3c:0001")).toBeTruthy();
    expect(within(panel).getByText("VIA 9 · Vial 6")).toBeTruthy();

    await act(() => kb.setKey(0, 0, 1, 0x04));
    const row = await within(log()).findByText("Set key L0 R0 C1 → KC_A");
    const item = row.closest("button")!;
    expect(within(item).getByText("write")).toBeTruthy();
    expect(within(item).getByText(/^OK · \d+ ms$/)).toBeTruthy();
    fireEvent.click(item);
    expect(item.getAttribute("aria-expanded")).toBe("true");
    expect(within(item).getByText(/^← /)).toBeTruthy();
  });

  it("filters to errors, and clears", async () => {
    const { sim, kb } = await setup();
    sim.handlers.unshift((msg) => {
      if (msg[0] === 0xfe && msg[1] === 0x0d && msg[2] === 0x02) {
        msg[0] = 0xff;
        return true;
      }
      return false;
    });
    await act(async () => {
      await kb.setKey(0, 0, 1, 0x05);
      await kb
        .extension(tapDanceExtension)!
        .set(0, { onTap: 0x04, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 })
        .catch(() => undefined);
    });
    fireEvent.click(screen.getByRole("button", { name: "Errors" }));
    await waitFor(() => expect(within(log()).getByText("Set tap dance 0")).toBeTruthy());
    expect(within(log()).getByText("rejected (status 255)")).toBeTruthy();
    expect(within(log()).queryByText(/^Set key/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(log()).getByText("No messages yet.")).toBeTruthy();
  });
});
