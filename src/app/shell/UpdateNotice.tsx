// SPDX-License-Identifier: GPL-2.0-or-later
// The desktop app's update notice (src/app/updates.ts): bottom right, out of
// the way of the undo toast, and never in front of the work. It offers; the
// user decides when to download and when to restart.

import { useEffect } from "react";
import type { Updater } from "../updates.ts";
import { Button } from "../ui/index.ts";
import { useUpdater } from "./useUpdater.ts";

const UP_TO_DATE_MS = 4000;

export function UpdateNotice({ updater, busy }: { updater: Updater; busy: boolean }) {
  const state = useUpdater(updater).state;

  useEffect(() => {
    if (state.kind !== "upToDate") return;
    const t = setTimeout(() => updater.dismiss(), UP_TO_DATE_MS);
    return () => clearTimeout(t);
  }, [state, updater]);

  if (state.kind === "idle") return null;
  let body: React.ReactNode;
  switch (state.kind) {
    case "checking":
      body = <p className="m-0">Checking for updates…</p>;
      break;
    case "available": {
      const note = state.notes.split("\n").find((line) => line.trim()) ?? "";
      body = (
        <>
          <p className="m-0 font-semibold">ViaLink {state.version} is available</p>
          {note && <p className="m-0 line-clamp-2 text-kumo-subtle">{note.replace(/^[#*\-\s]+/, "")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void updater.download()}>
              Update
            </Button>
            <Button size="sm" variant="outline" onClick={() => updater.later()}>
              Later
            </Button>
            <Button size="sm" variant="ghost" onClick={() => updater.skip()}>
              Skip this version
            </Button>
          </div>
        </>
      );
      break;
    }
    case "downloading": {
      const percent = state.total ? Math.min(100, Math.round((state.done / state.total) * 100)) : null;
      body = (
        <>
          <p className="m-0">
            Downloading ViaLink {state.version}…{percent !== null && ` ${percent}%`}
          </p>
          <progress
            className="w-full accent-accent"
            max={state.total ?? undefined}
            value={state.total ? state.done : undefined}
          />
        </>
      );
      break;
    }
    case "ready":
      body = (
        <>
          <p className="m-0 font-semibold">ViaLink {state.version} is downloaded</p>
          <p className="m-0 text-kumo-subtle">Restart ViaLink to finish updating.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              title={busy ? "Wait until the keyboard has finished writing" : undefined}
              onClick={() => void updater.installAndRestart()}
            >
              Restart now
            </Button>
            <Button size="sm" variant="outline" onClick={() => updater.later()}>
              Later
            </Button>
          </div>
        </>
      );
      break;
    case "installing":
      body = <p className="m-0">Installing ViaLink {state.version}…</p>;
      break;
    case "upToDate":
      body = <p className="m-0">ViaLink {__APP_VERSION__} is up to date.</p>;
      break;
    case "failed":
      body = (
        <>
          <p className="m-0">{state.message}</p>
          <div>
            <Button size="sm" variant="outline" onClick={() => updater.dismiss()}>
              OK
            </Button>
          </div>
        </>
      );
      break;
  }
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 rounded-lg border border-kumo-line bg-kumo-overlay px-3.5 py-3 shadow-lg"
    >
      {body}
    </div>
  );
}
