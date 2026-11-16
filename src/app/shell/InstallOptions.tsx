// SPDX-License-Identifier: GPL-2.0-or-later
// The start screen's two ways to install ViaLink from a browser: as a web app
// (install.ts; Chrome, Edge and Opera, the browsers that also have WebHID) or
// the standalone desktop app (src-tauri/), which needs no particular browser.
// In a browser without WebHID the web app button is greyed out and the
// standalone app is the main way in. App.tsx leaves this out in the desktop
// app and in the installed web app.

import { useState } from "react";
import { DESKTOP_DOWNLOADS, VIAL_UDEV_RULE } from "../docs.ts";
import { useInstallOffer } from "../install.ts";
import type { Os } from "../platform.ts";
import { Button, LinkButton } from "../ui/index.ts";

/** Which download to take, as the release lists them (ViaLink_<version>_x64-setup.exe, …). */
const DOWNLOAD: Record<Os, string> = {
  windows: "For Windows, take the -setup.exe installer (or the .msi).",
  mac: "For macOS, take the .dmg: one app for Apple Silicon and Intel.",
  linux: "For Linux, take the .AppImage, or the .deb or .rpm.",
  other: "For Windows, macOS and Linux.",
};

export function InstallOptions({ os, webHid }: { os: Os; webHid: boolean }) {
  const install = useInstallOffer();
  const [showHow, setShowHow] = useState(false);
  return (
    <section aria-labelledby="install-heading" className="mt-8 w-full border-t border-kumo-line pt-6">
      <h3 id="install-heading" className="m-0 text-base font-semibold">
        Install ViaLink
      </h3>
      <div className="mt-4 grid gap-5 text-left sm:grid-cols-2">
        <div className="flex flex-col items-start gap-2">
          <Button disabled={!webHid} onClick={() => (install ? void install() : setShowHow(true))}>
            Install as web app
          </Button>
          <p className="m-0 text-sm text-kumo-subtle">
            {!webHid
              ? "Needs Chrome, Edge or Opera: this browser can't talk to keyboards."
              : showHow
                ? "Use the install button at the right end of the address bar, or Install in the browser's menu. If ViaLink is installed already, the address bar offers to open it."
                : "Its own window and icon, and always the newest version."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <LinkButton variant={webHid ? "secondary" : "primary"} href={DESKTOP_DOWNLOADS} external>
            Install standalone app
          </LinkButton>
          <p className="m-0 text-sm text-kumo-subtle">
            The desktop app, for any browser or none. {DOWNLOAD[os]}
            {os === "linux" && !webHid && (
              // With WebHID the start screen says so above, for the browser.
              <>
                {" "}
                The keyboard also needs Vial&rsquo;s{" "}
                <a className="underline" href={VIAL_UDEV_RULE} target="_blank" rel="noreferrer">
                  udev rule
                </a>
                .
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
