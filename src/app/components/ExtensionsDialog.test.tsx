// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionsDialog } from "./ExtensionsDialog.tsx";

afterEach(cleanup);

describe("Extensions dialog", () => {
  it("links to the firmware an extension needs", () => {
    render(
      <ExtensionsDialog
        disabled={new Set()}
        onChange={() => undefined}
        keyboard={null}
        onClose={() => undefined}
      />,
    );
    const link = screen.getByRole("link", { name: "Theis194/vial-qmk" });
    expect(link.getAttribute("href")).toBe("https://github.com/Theis194/vial-qmk");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
