// SPDX-License-Identifier: GPL-2.0-or-later
// The modifier key shortcuts use on this computer, for hints: ⌘ on a Mac,
// Ctrl elsewhere. Shortcuts themselves accept either.

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "⌘" on a Mac, "Ctrl" elsewhere. */
export const MOD = mac ? "⌘" : "Ctrl";
