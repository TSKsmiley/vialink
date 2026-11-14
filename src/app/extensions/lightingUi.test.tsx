// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { installLighting, simVialRgb, type SimLighting } from "../../core/sim/lighting.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Editor } from "../components/Editor.tsx";
import { hsvCss } from "../../core/extensions/lighting.ts";

afterEach(cleanup);

const definition = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), `fixtures/definitions/${name}`)));

async function setup(
  lighting: Omit<SimLighting, "saves" | "saved"> | null = { vialrgb: simVialRgb() },
  file = "klor.vial.json.xz",
) {
  const klor = file.startsWith("klor");
  const sim = new SimulatedKeyboard({
    compressedDefinition: definition(file),
    rows: klor ? 8 : 2,
    cols: klor ? 6 : 2,
    layers: 2,
    encoderCount: klor ? 0 : 1,
  });
  const fw = lighting ? installLighting(sim, lighting) : null;
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onError = vi.fn();
  const onNotice = vi.fn();
  render(<Editor keyboard={kb} onError={onError} onNotice={onNotice} />);
  return { sim, fw: fw!, kb, onError, onNotice };
}

const open = () => fireEvent.click(screen.getByRole("tab", { name: "Lighting" }));

/** Drags a slider to `value` and lets go. */
function drag(slider: HTMLElement, ...values: number[]) {
  for (const v of values) fireEvent.change(slider, { target: { value: String(v) } });
  fireEvent.pointerUp(slider);
}

describe("Lighting view", () => {
  it("is a tab only on boards with lighting", async () => {
    await setup(null);
    expect(screen.queryByRole("tab", { name: "Lighting" })).toBeNull();
  });

  it("shows the board's VialRGB effects and settings", async () => {
    await setup();
    open();
    const rgb = screen.getByRole("region", { name: "RGB" });
    const effect = within(rgb).getByLabelText("Effect") as HTMLSelectElement;
    expect(effect.value).toBe("2");
    expect([...effect.options].map((o) => o.text)).toEqual([
      "Disable",
      "Direct Control",
      "Solid Color",
      "Breathing",
      "Cycle All",
      "Raindrops",
      "Typing Heatmap",
    ]);
    const brightness = within(rgb).getByLabelText("Brightness") as HTMLInputElement;
    expect(brightness.value).toBe("100");
    expect(brightness.max).toBe("200");
  });

  it("changes the effect on the keyboard, undoably, and saves on request", async () => {
    const { fw, kb } = await setup();
    open();
    fireEvent.change(screen.getByLabelText("Effect"), { target: { value: "24" } });
    await waitFor(() => expect(fw.vialrgb!.mode).toBe(24));
    expect(kb.history.nextUndo?.label).toBe("RGB effect: Solid Color → Raindrops");
    expect(screen.getByText(/Not saved/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save to keyboard" }));
    await waitFor(() => expect(fw.saves).toBe(1));
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
  });

  it("previews a slider drag on the keyboard and records one undo step when let go", async () => {
    const { fw, kb } = await setup();
    open();
    const hue = screen.getByLabelText("Hue");
    drag(hue, 30, 60, 90);
    await waitFor(() => expect(fw.vialrgb!.hue).toBe(90));
    await waitFor(() => expect(kb.history.nextUndo?.label).toBe("RGB colour: 0 → 90"));
    await kb.history.undo();
    expect(fw.vialrgb!.hue).toBe(0);
    await waitFor(() => expect((screen.getByLabelText("Hue") as HTMLInputElement).value).toBe("0"));
  });

  it("shows backlight and underglow on a qmk_backlight_rgblight board", async () => {
    const { fw } = await setup(
      {
        backlight: { brightness: 60, breathing: false },
        rgblight: { brightness: 90, effect: 6, speed: 2, hue: 40, sat: 200 },
      },
      "test_2x2_backlight_rgblight.vial.json.xz",
    );
    open();
    const underglow = screen.getByRole("region", { name: "Underglow" });
    // Rainbow Mood ignores the colour, so its sliders are hidden.
    expect(within(underglow).queryByLabelText("Hue")).toBeNull();
    fireEvent.change(within(underglow).getByLabelText("Effect"), { target: { value: "1" } });
    await waitFor(() => expect(within(underglow).getByLabelText("Hue")).toBeTruthy());

    const backlight = screen.getByRole("region", { name: "Backlight" });
    fireEvent.click(within(backlight).getByLabelText("Breathing"));
    await waitFor(() => expect(fw.backlight!.breathing).toBe(true));
  });

  it("turns QMK HSV bytes into CSS colours", () => {
    expect(hsvCss(0, 255)).toBe("rgb(255 0 0)");
    expect(hsvCss(85, 255)).toBe("rgb(0 255 0)");
    expect(hsvCss(0, 0, 128)).toBe("rgb(128 128 128)");
  });
});
