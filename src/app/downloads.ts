// SPDX-License-Identifier: GPL-2.0-or-later
// Which desktop app file to download for this computer, straight from the
// latest release: the -setup.exe on Windows, the .dmg on a Mac, the .AppImage
// on Linux (it runs on most distributions; the release page also has .deb,
// .rpm and .msi). Looked up when the download button is clicked, so visiting
// the start page makes no request to GitHub.

import { DESKTOP_DOWNLOADS, LATEST_RELEASE_API } from "./docs.ts";
import type { Os } from "./platform.ts";

const FILE: Record<Exclude<Os, "other">, RegExp> = {
  windows: /_x64-setup\.exe$/,
  mac: /\.dmg$/,
  linux: /\.AppImage$/,
};

interface Release {
  assets: { name: string; browser_download_url: string }[];
}

/** The file for this computer in a release, or null when it has none. */
export function pickDownload(os: Os, release: Release): string | null {
  if (os === "other") return null;
  return release.assets.find((a) => FILE[os].test(a.name))?.browser_download_url ?? null;
}

/** The latest release's file for this computer; the release page when that can't be found. */
export async function desktopDownloadUrl(os: Os, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetcher(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return DESKTOP_DOWNLOADS;
    return pickDownload(os, (await response.json()) as Release) ?? DESKTOP_DOWNLOADS;
  } catch {
    return DESKTOP_DOWNLOADS;
  }
}
