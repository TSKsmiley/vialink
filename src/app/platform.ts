// SPDX-License-Identifier: GPL-2.0-or-later
// Facts about this computer for hints: the modifier key shortcuts use (⌘ on a
// Mac, Ctrl elsewhere; shortcuts themselves accept either) and which desktop
// app download fits it.

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "⌘" on a Mac, "Ctrl" elsewhere. */
export const MOD = mac ? "⌘" : "Ctrl";

/** The desktop systems ViaLink's desktop app is built for, or "other" (phones, tablets, the rest). */
export type Os = "windows" | "mac" | "linux" | "other";

export function currentOs(
  nav: Pick<Navigator, "platform" | "userAgent" | "maxTouchPoints"> | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator,
): Os {
  if (!nav) return "other";
  // Android says Linux and an iPad says Mac, but neither runs the desktop app.
  if (/Android|iPhone|iPad/.test(nav.userAgent) || (/Mac/.test(nav.platform) && nav.maxTouchPoints > 1))
    return "other";
  if (/Win/.test(nav.platform)) return "windows";
  if (/Mac/.test(nav.platform)) return "mac";
  if (/Linux/.test(nav.platform)) return "linux";
  return "other";
}
