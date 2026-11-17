// SPDX-License-Identifier: GPL-2.0-or-later
// The start page's two ways to install ViaLink from a browser: as a web app
// (install.ts; Chrome, Edge and Opera, the browsers that also have WebHID) or
// the standalone desktop app (src-tauri/), which needs no browser. The
// download button fetches the file for this computer from the latest release
// (downloads.ts). Without WebHID (Firefox, Safari) the web app button is
// greyed out and the download is the main button. ConnectScreen leaves this
// out in the desktop app and in the installed web app.

import { useState, type MouseEvent } from "react";
import { DESKTOP_DOWNLOADS } from "../docs.ts";
import { desktopDownloadUrl } from "../downloads.ts";
import { useInstallOffer } from "../install.ts";
import type { Os } from "../platform.ts";
import { Button, LinkButton } from "../ui/index.ts";

const OS_NAME: Record<Os, string | null> = { windows: "Windows", mac: "macOS", linux: "Linux", other: null };

export function InstallOptions({
  os,
  webHid,
  download = desktopDownloadUrl,
  navigate = (url) => window.location.assign(url),
}: {
  os: Os;
  webHid: boolean;
  /** Where the download button goes, and going there (tests replace both). */
  download?: (os: Os) => Promise<string>;
  navigate?: (url: string) => void;
}) {
  const install = useInstallOffer();
  const [showHow, setShowHow] = useState(false);
  const osName = OS_NAME[os];

  const onDownload = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (!osName) return; // no build for this system: the link shows the release page
    e.preventDefault();
    navigate(await download(os));
  };

  return (
    <section
      aria-labelledby="install-heading"
      className="flex flex-col gap-4 lg:mt-2 lg:border-l lg:border-kumo-line lg:pl-8"
    >
      <h2 id="install-heading" className="m-0 text-[17px] font-semibold">
        Install ViaLink
      </h2>
      <div className="grid max-w-[760px] gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-1">
        <div className="flex flex-col items-start gap-2">
          <Button disabled={!webHid} onClick={() => (install ? void install() : setShowHow(true))}>
            Install as web app
          </Button>
          <p className="m-0 text-sm text-kumo-subtle">
            {!webHid
              ? "Needs Chrome, Edge or Opera."
              : showHow
                ? "Use the install button at the right end of the address bar."
                : "Opens in its own window, like any other app."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <LinkButton
            variant={webHid ? "secondary" : "primary"}
            href={DESKTOP_DOWNLOADS}
            onClick={onDownload}
          >
            {osName ? `Download for ${osName}` : "Download the standalone app"}
          </LinkButton>
          <p className="m-0 text-sm text-kumo-subtle">
            {osName ? "The standalone app. It doesn't need a browser. " : "For Windows, macOS and Linux. "}
            {osName && (
              <a className="underline" href={DESKTOP_DOWNLOADS} target="_blank" rel="noreferrer">
                Other downloads
              </a>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
