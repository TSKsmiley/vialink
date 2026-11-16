// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { DESKTOP_DOWNLOADS } from "./docs.ts";
import { desktopDownloadUrl, pickDownload } from "./downloads.ts";

// The files of desktop-v0.3.1, as GitHub's API lists them.
const base = "https://github.com/TSKsmiley/vialink/releases/download/desktop-v0.3.1/";
const release = {
  assets: [
    "latest.json",
    "ViaLink-0.3.1-1.x86_64.rpm",
    "ViaLink_0.3.1_amd64.AppImage",
    "ViaLink_0.3.1_amd64.AppImage.sig",
    "ViaLink_0.3.1_amd64.deb",
    "ViaLink_0.3.1_universal.dmg",
    "ViaLink_0.3.1_x64-setup.exe",
    "ViaLink_0.3.1_x64-setup.exe.sig",
    "ViaLink_0.3.1_x64_en-US.msi",
    "ViaLink_universal.app.tar.gz",
  ].map((name) => ({ name, browser_download_url: base + name })),
};

describe("the desktop app download for this computer", () => {
  it("picks the installer for each system, never a signature or update file", () => {
    expect(pickDownload("windows", release)).toBe(base + "ViaLink_0.3.1_x64-setup.exe");
    expect(pickDownload("mac", release)).toBe(base + "ViaLink_0.3.1_universal.dmg");
    expect(pickDownload("linux", release)).toBe(base + "ViaLink_0.3.1_amd64.AppImage");
    expect(pickDownload("other", release)).toBeNull();
  });

  it("falls back to the release page when GitHub can't be asked or lacks the file", async () => {
    const answer = (body: unknown, ok = true) =>
      (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    expect(await desktopDownloadUrl("linux", answer(release))).toBe(base + "ViaLink_0.3.1_amd64.AppImage");
    expect(await desktopDownloadUrl("linux", answer({}, false))).toBe(DESKTOP_DOWNLOADS);
    expect(await desktopDownloadUrl("mac", answer({ assets: [] }))).toBe(DESKTOP_DOWNLOADS);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await desktopDownloadUrl("windows", offline)).toBe(DESKTOP_DOWNLOADS);
  });
});
