// SPDX-License-Identifier: GPL-2.0-or-later
// Installing the website as an app (a PWA). Chromium browsers fire
// beforeinstallprompt when the page meets their install rules
// (public/manifest.webmanifest) and ViaLink isn't installed yet; while that
// offer stands, the ⋯ menu shows "Install ViaLink as an app" (TopBar.tsx), and
// the start screen's "Install as web app" opens it (InstallOptions.tsx). The
// browser's own install button in the address bar works either way. No
// service worker: the installed app loads the site like a tab, so it is never
// stuck on an old version, and the desktop app is the one that works offline.

import { useSyncExternalStore } from "react";

/** Chromium's BeforeInstallPromptEvent, which TypeScript's DOM types lack. */
interface InstallOfferEvent extends Event {
  prompt(): Promise<unknown>;
}

let offer: InstallOfferEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  // At import, before React renders: the offer can come before the first paint.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // the menu item offers it instead of the browser's mini-infobar
    offer = event as InstallOfferEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    changed();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install dialog while it offers one; null otherwise. */
export function useInstallOffer(): (() => Promise<void>) | null {
  const current = useSyncExternalStore(subscribe, () => offer);
  if (!current) return null;
  return async () => {
    // An offer can be shown once; the browser makes a new one if it is turned down.
    offer = null;
    changed();
    await current.prompt();
  };
}

/** True in the installed web app's own window, where offering to install it makes no sense. */
export function runsAsInstalledApp(): boolean {
  if (typeof matchMedia === "undefined") return false;
  return ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"].some(
    (mode) => matchMedia(`(display-mode: ${mode})`).matches,
  );
}
