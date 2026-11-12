// SPDX-License-Identifier: GPL-2.0-or-later
import { combosExtension } from "./combos.ts";
import { keyOverridesExtension } from "./key-overrides.ts";
import { layerNamesExtension } from "./layerNames.ts";
import { tapDanceExtension } from "./tap-dance.ts";
import type { KeyboardExtension } from "./types.ts";

export type { ActiveExtension, ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

/** Every built-in extension, in probe order. */
export const BUILTIN_EXTENSIONS: readonly KeyboardExtension<unknown>[] = [
  layerNamesExtension as KeyboardExtension<unknown>,
  tapDanceExtension as KeyboardExtension<unknown>,
  combosExtension as KeyboardExtension<unknown>,
  keyOverridesExtension as KeyboardExtension<unknown>,
];
