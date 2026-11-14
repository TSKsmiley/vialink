// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SidePanelLayout } from "./SidePanelLayout.tsx";
import { SidePanelTaken } from "./sidePanelSlot.ts";

afterEach(cleanup);

it("draws the view's side panel unless the device panel has the slot", () => {
  const view = (taken: boolean) => (
    <SidePanelTaken.Provider value={taken}>
      <SidePanelLayout label="View" panel={<aside aria-label="Inspector" />}>
        <p>Main</p>
      </SidePanelLayout>
    </SidePanelTaken.Provider>
  );
  const { rerender } = render(view(false));
  expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
  rerender(view(true));
  expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
  expect(screen.getByText("Main")).toBeTruthy();
});
