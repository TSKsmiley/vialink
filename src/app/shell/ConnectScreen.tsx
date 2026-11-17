// SPDX-License-Identifier: GPL-2.0-or-later
// The start page, shown until a keyboard is connected.
// - On the website it is the landing page: what ViaLink does, the keyboards it
//   can open (one click for those used before), the demo, the demo keyboard's
//   keymap to look at (KeyboardPreview) and the two ways to install it
//   (InstallOptions).
// - In the desktop app, which is installed already, it only finds the
//   keyboard: the ones plugged in, the demo, and the udev hint on Linux.
// The experimental note sits with the buttons in both, where people decide to
// connect. After an unplug it waits for the keyboard to come back instead
// (App.tsx, reconnect.ts).

import { WarningIcon } from "@phosphor-icons/react";
import type { DeviceInfo } from "../../core/transport/types.ts";
import { webHidSupported, type ConnectTarget } from "../connection.ts";
import { isDesktop } from "../desktop.ts";
import { GITHUB_PROJECT, VIAL_UDEV_RULE } from "../docs.ts";
import { runsAsInstalledApp } from "../install.ts";
import { currentOs } from "../platform.ts";
import { Banner, Button } from "../ui/index.ts";
import { InstallOptions } from "./InstallOptions.tsx";
import { KeyboardPreview } from "./KeyboardPreview.tsx";
import { Logo } from "./Logo.tsx";

/** A keyboard ViaLink can open straight away, without the browser's chooser. */
export interface AvailableKeyboard {
  key: string;
  name: string;
  vendorId: number;
  productId: number;
  target: ConnectTarget;
}

const link = "underline decoration-kumo-line underline-offset-2 hover:decoration-current";

export function ConnectScreen({
  onConnect,
  available,
  waitingFor,
  onStopWaiting,
}: {
  onConnect: (target: ConnectTarget) => void;
  available: readonly AvailableKeyboard[] | null;
  /** The keyboard that was unplugged, while waiting for it to come back. */
  waitingFor: DeviceInfo | null;
  onStopWaiting: () => void;
}) {
  const desktop = isDesktop();
  const supported = webHidSupported();
  const os = currentOs();
  if (waitingFor) {
    return (
      <section
        aria-labelledby="waiting-title"
        className="mx-auto my-10 flex max-w-xl flex-col items-center gap-3 px-4 text-center"
      >
        <h2 id="waiting-title" className="m-0 text-xl font-semibold">
          {waitingFor.productName || "The keyboard"} was unplugged
        </h2>
        <p role="status" className="m-0 text-kumo-subtle">
          Plug it back in and ViaLink connects to it again. Undo history starts afresh after reconnecting.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {!desktop && supported && (
            <Button onClick={() => onConnect({ kind: "webhid" })}>Choose it again…</Button>
          )}
          <Button onClick={onStopWaiting}>Stop waiting</Button>
        </div>
      </section>
    );
  }

  const known = available ?? [];
  if (desktop) {
    return (
      <section
        aria-labelledby="start-title"
        className="mx-auto my-auto flex w-full max-w-[34rem] flex-col items-center gap-4 px-4 py-12 text-center"
      >
        <Logo size={56} />
        <h1 id="start-title" className="m-0 text-[26px] font-semibold tracking-[-0.015em]">
          Connect a keyboard
        </h1>
        <p role="status" className="m-0 text-kumo-subtle">
          {available === null
            ? "Looking for keyboards…"
            : known.length === 0
              ? "No keyboard found yet. Plug one in and it shows up here."
              : "Choose a keyboard."}
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-3">
          {known.map((k) => (
            <Button key={k.key} variant="primary" onClick={() => onConnect(k.target)}>
              Connect {k.name}
            </Button>
          ))}
          <Button onClick={() => onConnect({ kind: "demo" })}>Try the demo keyboard</Button>
        </div>
        {available !== null && known.length === 0 && os === "linux" && (
          <p className="m-0 text-sm text-kumo-subtle">
            Plugged in but not listed? On Linux the keyboard needs Vial&rsquo;s{" "}
            <a className={link} href={VIAL_UDEV_RULE} target="_blank" rel="noreferrer">
              udev rule
            </a>
            .
          </p>
        )}
        <ExperimentalNote className="mt-6 text-left" />
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-14 px-4 pt-10 pb-12 md:px-8 md:pt-16">
      {/* Install sits beside the headline on wide screens and under it on narrow ones, so the download is on the first screen either way. */}
      <div className="grid items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="landing-title" className="flex flex-col items-start gap-5">
          <h1
            id="landing-title"
            className="m-0 max-w-[13ch] text-[38px] leading-[1.04] font-semibold tracking-[-0.025em] md:text-[54px]"
          >
            Configure your Vial keyboard
          </h1>
          <p className="m-0 max-w-[56ch] text-base leading-[1.55] text-kumo-subtle md:text-[17px]">
            Remap keys and layers, and build macros, tap dances and combos. Every change goes to the keyboard
            as you make it, and every change can be undone. Free and open source,{" "}
            <a className={link} href={GITHUB_PROJECT}>
              on GitHub
            </a>
            .
          </p>

          {!supported && (
            <div className="max-w-[64ch]">
              <Banner
                variant="alert"
                size="sm"
                description="This browser can't talk to keyboards. Open ViaLink in Chrome, Edge or Opera, or download the standalone app."
              />
            </div>
          )}

          <div className="mt-1 flex flex-wrap gap-3">
            {known.map((k) => (
              <Button key={k.key} variant="primary" onClick={() => onConnect(k.target)}>
                Connect {k.name}
              </Button>
            ))}
            {supported && (
              <Button
                variant={known.length ? "secondary" : "primary"}
                onClick={() => onConnect({ kind: "webhid" })}
              >
                {known.length ? "Another keyboard…" : "Connect keyboard"}
              </Button>
            )}
            <Button onClick={() => onConnect({ kind: "demo" })}>Try the demo keyboard</Button>
          </div>

          {supported && os === "linux" && (
            <p className="m-0 text-sm text-kumo-subtle">
              On Linux the keyboard first needs Vial&rsquo;s{" "}
              <a className={link} href={VIAL_UDEV_RULE} target="_blank" rel="noreferrer">
                udev rule
              </a>
              .
            </p>
          )}

          <ExperimentalNote />
        </section>
        {!runsAsInstalledApp() && <InstallOptions os={os} webHid={supported} />}
      </div>

      <KeyboardPreview />
    </div>
  );
}

/** ViaLink is experimental: where it came from, what it was tested on, and to keep a backup. */
function ExperimentalNote({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`m-0 flex max-w-[64ch] items-start gap-2 text-[13px] leading-[1.5] text-kumo-subtle ${className}`}
    >
      <WarningIcon weight="fill" aria-hidden="true" className="mt-[3px] shrink-0 text-kumo-warning" />
      <span>
        Experimental: most of ViaLink was written by an AI coding assistant, and it has only been tested on
        one keyboard, the{" "}
        <a className={link} href="https://github.com/GEIGEIGEIST/KLOR" target="_blank" rel="noreferrer">
          KLOR
        </a>
        . Save a backup of your layout before you change anything.
      </span>
    </p>
  );
}
