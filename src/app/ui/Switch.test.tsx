// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Switch } from "./index.ts";

afterEach(cleanup);

it("puts the accent class on the switch itself, where theme.css recolours it", () => {
  render(<Switch label="Capture keys" checked onCheckedChange={() => undefined} className="extra" />);
  const control = screen.getByRole("switch", { name: "Capture keys" });
  expect(control.classList.contains("vl-switch")).toBe(true);
  expect(control.classList.contains("extra")).toBe(true);
  expect(control.hasAttribute("data-checked")).toBe(true);
  expect(control.querySelector(":scope > div")).not.toBeNull();
});
