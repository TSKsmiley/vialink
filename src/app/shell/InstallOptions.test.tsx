// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The start screen's "Install as web app" and "Install standalone app", and
// which desktop download fits which computer (platform.ts).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_DOWNLOADS } from "../docs.ts";
import { currentOs } from "../platform.ts";
import { InstallOptions } from "./InstallOptions.tsx";

afterEach(cleanup);

const webApp = () => screen.getByRole("button", { name: "Install as web app" }) as HTMLButtonElement;
const standalone = () => screen.getByRole("link", { name: "Install standalone app" }) as HTMLAnchorElement;

describe("installing ViaLink from the start screen", () => {
  it("greys out the web app without WebHID and points to the standalone app", () => {
    render(<InstallOptions os="linux" webHid={false} />);
    expect(webApp().disabled).toBe(true);
    expect(screen.getByText(/Needs Chrome, Edge or Opera/)).toBeTruthy();
    expect(standalone().href).toBe(DESKTOP_DOWNLOADS);
    expect(standalone().target).toBe("_blank");
    expect(screen.getByText(/take the \.AppImage, or the \.deb or \.rpm/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "udev rule" })).toBeTruthy();
  });

  it("names the download for the computer it runs on", () => {
    render(<InstallOptions os="windows" webHid />);
    expect(screen.getByText(/take the -setup\.exe installer/)).toBeTruthy();
    cleanup();
    render(<InstallOptions os="mac" webHid />);
    expect(screen.getByText(/take the \.dmg/)).toBeTruthy();
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
