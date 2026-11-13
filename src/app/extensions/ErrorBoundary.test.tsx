// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionErrorBoundary } from "./ErrorBoundary.tsx";

afterEach(cleanup);

describe("extension error boundary", () => {
  it("shows which extension failed in its place and keeps the rest drawing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs the caught error
    let broken = true;
    function Flaky() {
      if (broken) throw new Error("bad state");
      return <p>Key notes</p>;
    }
    render(
      <div>
        <p>ViaLink keeps working</p>
        <ExtensionErrorBoundary name="Key notes">
          <Flaky />
        </ExtensionErrorBoundary>
      </div>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Key notes failed to draw");
    expect(screen.getByText("bad state")).toBeTruthy();
    expect(screen.getByText("ViaLink keeps working")).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Key notes")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
