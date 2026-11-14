// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Updater, type UpdatePrefs, type UpdaterBackend } from "../updates.ts";
import { UpdateNotice } from "./UpdateNotice.tsx";

afterEach(cleanup);

const prefs: UpdatePrefs = { get: () => null, set: () => undefined };

function offering(installed: string[]): UpdaterBackend {
  return {
    enabled: async () => true,
    check: async () => ({
      version: "0.2.0",
      notes: "Faster keyboard loads in the desktop app.\nMore below.",
      download: async (onProgress) => onProgress(10, 10),
      installAndRestart: async () => void installed.push("0.2.0"),
    }),
  };
}

it("offers the update and restarts only when asked", async () => {
  const installed: string[] = [];
  const updater = new Updater(offering(installed), prefs);
  render(<UpdateNotice updater={updater} busy={false} />);
  expect(screen.queryByRole("status")).toBeNull();

  await act(() => updater.start(0, () => Promise.resolve()));
  expect(screen.getByText("ViaLink 0.2.0 is available")).toBeTruthy();
  expect(screen.getByText("Faster keyboard loads in the desktop app.")).toBeTruthy();

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update" })));
  expect(screen.getByText("ViaLink 0.2.0 is downloaded")).toBeTruthy();
  expect(installed).toEqual([]);

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart now" })));
  expect(installed).toEqual(["0.2.0"]);
});

it("holds Restart now while the keyboard is busy, and Later hides the notice", async () => {
  const updater = new Updater(offering([]), prefs);
  const { rerender } = render(<UpdateNotice updater={updater} busy={true} />);
  await act(() => updater.start(0, () => Promise.resolve()));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update" })));
  expect((screen.getByRole("button", { name: "Restart now" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<UpdateNotice updater={updater} busy={false} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Later" })));
  expect(screen.queryByRole("status")).toBeNull();
});
