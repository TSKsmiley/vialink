// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The start page: the website's landing page with the demo keyboard's keymap
// to look at, and the desktop app's own short start screen.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { DEMO_LAYER_NAMES, demoKeymap } from "../demoKeymap.ts";
import { ConnectScreen } from "./ConnectScreen.tsx";
import { KeyboardPreview } from "./KeyboardPreview.tsx";

afterEach(() => {
  cleanup();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function demo() {
  const { keymap, encoders } = demoKeymap();
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    keymap,
    encoderCount: 2,
    encoders,
    layerNames: DEMO_LAYER_NAMES,
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
}

describe("the start page's keyboard", () => {
  it("says what a clicked key does, on each layer", async () => {
    const kb = await demo();
    render(<KeyboardPreview load={async () => kb} />);
    expect(screen.getByText(/Click a key to see what it does/)).toBeTruthy();
    const key = (pos: string) => screen.getAllByRole("button", { name: new RegExp(`^Key ${pos}:`) })[0];
    fireEvent.click(await waitFor(() => key("3,4")));
    expect(screen.getByText("Space, or Lower while held")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Raise" }));
    expect(screen.getByRole("button", { name: "Raise", pressed: true })).toBeTruthy();
    fireEvent.click(key("1,1")); // F6 on Raise
    expect(document.querySelector("figcaption")?.textContent).toMatch(/F6.* on Raise$/);
  });
});

describe("the start page", () => {
  const props = { onConnect: vi.fn(), available: [], waitingFor: null, onStopWaiting: vi.fn() };

  it("is the landing page in a browser, pointing to the standalone app without WebHID", () => {
    render(<ConnectScreen {...props} />); // jsdom has no navigator.hid
    expect(screen.getByRole("heading", { level: 1, name: "Configure your Vial keyboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "on GitHub" })).toBeTruthy();
    expect(screen.getByText(/This browser can't talk to keyboards/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect keyboard" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Install ViaLink" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Install as web app" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("note").textContent).toMatch(/Experimental/);
  });

  it("only finds the keyboard in the desktop app", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const onConnect = vi.fn();
    const klor = { key: "a", name: "Klor", vendorId: 1, productId: 2, target: { kind: "demo" as const } };
    render(<ConnectScreen {...props} onConnect={onConnect} available={[klor]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Connect a keyboard" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Install ViaLink" })).toBeNull();
    expect(screen.queryByText(/Configure your Vial keyboard/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect Klor" }));
    expect(onConnect).toHaveBeenCalledWith(klor.target);
    expect(screen.getByRole("note").textContent).toMatch(/Experimental/);
  });
});
