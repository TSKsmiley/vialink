// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The "More" menu in the desktop app, where the updater adds its items. Its
// "ViaLink <version>" label once sat outside a menu group, which Base UI
// refuses: opening the menu then took the whole app down (0.2.0, 0.2.1).
// The logo, which disconnects, and the install offer of the web app.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Keyboard } from "../../core/keyboard.ts";
import { SimulatedKeyboard } from "../../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { Updater, type UpdatePrefs } from "../updates.ts";
import { TopBar } from "./TopBar.tsx";
import { useHistory, type HistoryControls } from "./useHistory.ts";

afterEach(cleanup);

const prefs: UpdatePrefs = { get: () => null, set: () => undefined };

it("opens the More menu with the updater's items", async () => {
  const updater = new Updater({ enabled: async () => true, check: async () => null }, prefs);
  await act(() => updater.start(0, () => Promise.resolve()));
  render(
    <TopBar
      keyboard={null}
      history={{} as HistoryControls}
      showLog={false}
      onToggleLog={() => undefined}
      onExtensions={() => undefined}
      onDisconnect={() => undefined}
      onError={() => undefined}
      updater={updater}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(await screen.findByText(`ViaLink ${__APP_VERSION__}`)).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Check for updates" })).toBeTruthy();
  expect(screen.getByRole("menuitemcheckbox", { name: "Check for updates at launch" })).toBeTruthy();
});

it("disconnects when the logo is clicked, and is plain text with no keyboard", async () => {
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
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const onDisconnect = vi.fn();
  function Harness({ keyboard }: { keyboard: Keyboard | null }) {
    const history = useHistory(kb, () => undefined);
    return (
      <TopBar
        keyboard={keyboard}
        history={history}
        showLog={false}
        onToggleLog={() => undefined}
        onExtensions={() => undefined}
        onDisconnect={onDisconnect}
        onError={() => undefined}
      />
    );
  }
  const { rerender } = render(<Harness keyboard={kb} />);
  const logo = screen.getByRole("button", { name: "ViaLink" });
  expect(logo.title).toBe("Disconnect and go back to the start screen");
  fireEvent.click(logo);
  expect(onDisconnect).toHaveBeenCalledTimes(1);

  rerender(<Harness keyboard={null} />);
  expect(screen.queryByRole("button", { name: "ViaLink" })).toBeNull();
  expect(screen.getByText("ViaLink")).toBeTruthy();
});

it("offers to install the web app while the browser does, once", async () => {
  render(
    <TopBar
      keyboard={null}
      history={{} as HistoryControls}
      showLog={false}
      onToggleLog={() => undefined}
      onExtensions={() => undefined}
      onDisconnect={() => undefined}
      onError={() => undefined}
    />,
  );
  const more = () => fireEvent.click(screen.getByRole("button", { name: "More" }));
  more();
  await screen.findByText("Keyboard layout");
  expect(screen.queryByRole("menuitem", { name: "Install ViaLink as an app" })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

  const prompt = vi.fn(async () => ({ outcome: "accepted" }));
  const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
  act(() => void window.dispatchEvent(offer));
  expect(offer.defaultPrevented).toBe(true);
  more();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Install ViaLink as an app" }));
  expect(prompt).toHaveBeenCalledTimes(1);

  more();
  await screen.findByText("Keyboard layout");
  expect(screen.queryByRole("menuitem", { name: "Install ViaLink as an app" })).toBeNull();
});
