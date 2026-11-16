// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The start page's "Install as web app" and the standalone app's download
// button, and which desktop download fits which computer (platform.ts).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_DOWNLOADS } from "../docs.ts";
import { currentOs } from "../platform.ts";
import { InstallOptions } from "./InstallOptions.tsx";

afterEach(cleanup);

const webApp = () => screen.getByRole("button", { name: "Install as web app" }) as HTMLButtonElement;

describe("installing ViaLink from the start page", () => {
  it("greys out the web app without WebHID and downloads the standalone app for this computer", async () => {
    const download = vi.fn(async () => "https://example.test/ViaLink_amd64.AppImage");
    const navigate = vi.fn();
    render(<InstallOptions os="linux" webHid={false} download={download} navigate={navigate} />);
    expect(webApp().disabled).toBe(true);
    expect(screen.getByText("Needs Chrome, Edge or Opera.")).toBeTruthy();
    const button = screen.getByRole("link", { name: "Download for Linux" }) as HTMLAnchorElement;
    expect(button.href).toBe(DESKTOP_DOWNLOADS); // where it goes without JavaScript
    fireEvent.click(button);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://example.test/ViaLink_amd64.AppImage"));
    expect(download).toHaveBeenCalledWith("linux");
    expect((screen.getByRole("link", { name: "Other downloads" }) as HTMLAnchorElement).href).toBe(
      DESKTOP_DOWNLOADS,
    );
  });

  it("names the system, and sends other systems to the release page", () => {
    render(<InstallOptions os="windows" webHid />);
    expect(screen.getByRole("link", { name: "Download for Windows" })).toBeTruthy();
    cleanup();
    render(<InstallOptions os="mac" webHid />);
    expect(screen.getByRole("link", { name: "Download for macOS" })).toBeTruthy();
    cleanup();
    const navigate = vi.fn();
    render(<InstallOptions os="other" webHid navigate={navigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Download the standalone app" }));
    expect(navigate).not.toHaveBeenCalled(); // the link itself opens the release page
    expect(screen.getByText(/For Windows, macOS and Linux/)).toBeTruthy();
  });

  it("explains the browser's own install button when the browser has made no offer", () => {
    render(<InstallOptions os="windows" webHid />);
    expect(webApp().disabled).toBe(false);
    fireEvent.click(webApp());
    expect(screen.getByText(/install button at the right end of the address bar/)).toBeTruthy();
  });

  it("opens the browser's install dialog when it offers one", () => {
    render(<InstallOptions os="windows" webHid />);
    const prompt = vi.fn(async () => ({ outcome: "accepted" }));
    act(() => void window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt })));
    fireEvent.click(webApp());
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/install button at the right end of the address bar/)).toBeNull();
  });
});

describe("currentOs", () => {
  const nav = (platform: string, userAgent = "", maxTouchPoints = 0) => ({
    platform,
    userAgent,
    maxTouchPoints,
  });
  it("tells the desktop systems apart, and phones and tablets from them", () => {
    expect(currentOs(nav("Win32"))).toBe("windows");
    expect(currentOs(nav("MacIntel"))).toBe("mac");
    expect(currentOs(nav("Linux x86_64"))).toBe("linux");
    expect(currentOs(nav("Linux armv8l", "Mozilla/5.0 (Linux; Android 14)"))).toBe("other");
    expect(currentOs(nav("MacIntel", "Mozilla/5.0 (Macintosh)", 5))).toBe("other"); // an iPad
    expect(currentOs(undefined)).toBe("other");
  });
});
