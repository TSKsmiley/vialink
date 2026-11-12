// SPDX-License-Identifier: GPL-2.0-or-later
import { layerNamesExtension } from "./layerNames.ts";
import { macrosExtension } from "./macros.ts";
import { tapDanceExtension } from "./tap-dance.ts";
import { combosExtension } from "./combos.ts";
import { keyOverridesExtension } from "./key-overrides.ts";
import { altRepeatKeyExtension } from "./alt-repeat-key.ts";
import { qmkSettingsExtension } from "./qmk-settings.ts";
import { layerSharingExtension } from "./layer-sharing.ts";
import type { KeyboardExtension } from "./types.ts";

export type { ActiveExtension, ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

/** Every built-in extension, in probe order. */
export const BUILTIN_EXTENSIONS: readonly KeyboardExtension<unknown>[] = [
  layerNamesExtension as KeyboardExtension<unknown>,
  macrosExtension as KeyboardExtension<unknown>,
  tapDanceExtension as KeyboardExtension<unknown>,
  combosExtension as KeyboardExtension<unknown>,
  keyOverridesExtension as KeyboardExtension<unknown>,
  altRepeatKeyExtension as KeyboardExtension<unknown>,
  qmkSettingsExtension as KeyboardExtension<unknown>,
  layerSharingExtension as KeyboardExtension<unknown>,
];
