// SPDX-License-Identifier: GPL-2.0-or-later
import { useSyncExternalStore } from "react";
import type { Updater } from "../updates.ts";

/** Re-renders on every change to the updater, settings included. */
export function useUpdater(updater: Updater): Updater {
  useSyncExternalStore(
    (cb) => updater.subscribe(cb),
    () => updater.revision,
  );
  return updater;
}
