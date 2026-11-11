// SPDX-License-Identifier: GPL-2.0-or-later
import { altRepeatKeyExtension } from "./alt-repeat-key.ts";
import { layerNamesExtension } from "./layerNames.ts";
import type { KeyboardExtension } from "./types.ts";

export type { ActiveExtension, ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

/** Every built-in extension, in probe order. */
export const BUILTIN_EXTENSIONS: readonly KeyboardExtension<unknown>[] = [
  layerNamesExtension as KeyboardExtension<unknown>,
  altRepeatKeyExtension as KeyboardExtension<unknown>,
];
