// SPDX-License-Identifier: GPL-2.0-or-later
import { layerNamesExtension } from "./layerNames.ts";
import { macrosExtension } from "./macros.ts";
import { tapDanceExtension } from "./tap-dance.ts";
import { combosExtension } from "./combos.ts";
import { keyOverridesExtension } from "./key-overrides.ts";
import { altRepeatKeyExtension } from "./alt-repeat-key.ts";
import { qmkSettingsExtension } from "./qmk-settings.ts";
import { layerSharingExtension } from "./layer-sharing.ts";
import type { CustomCommand, KeyboardExtension } from "./types.ts";

export type {
  ActiveExtension,
  CompatibleExtension,
  CustomCommand,
  DeviceContext,
  ExtensionRestoreStep,
  HostContext,
  KeyboardExtension,
  NonstandardExtension,
  StandardExtension,
} from "./types.ts";
export { ExtensionCommandError } from "./types.ts";
export type { ExtensionPoint, ExtensionStatus } from "./manifest.ts";
export type { BrowserStorage, StateHandle, StateOptions } from "./state.ts";

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

/** Every custom command the built-in non-standard extensions declare, for the HID log. */
export const CUSTOM_COMMANDS: readonly CustomCommand[] = BUILTIN_EXTENSIONS.flatMap((ext) =>
  ext.group === "nonstandard" ? ext.commands : [],
);
