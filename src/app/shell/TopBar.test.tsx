// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The "More" menu in the desktop app, where the updater adds its items. Its
// "ViaLink <version>" label once sat outside a menu group, which Base UI
// refuses: opening the menu then took the whole app down (0.2.0, 0.2.1).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Updater, type UpdatePrefs } from "../updates.ts";
import { TopBar } from "./TopBar.tsx";
import type { HistoryControls } from "./useHistory.ts";

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
