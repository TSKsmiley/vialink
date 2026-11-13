// SPDX-License-Identifier: GPL-2.0-or-later
// Layer names has no view: names show everywhere through the core layer names
// service (core/extensions/services.ts), and renaming lives on the layer card.
import { layerNamesExtension } from "../../core/extensions/layerNames.ts";
import type { AppExtension } from "./registry.tsx";

export const layerNamesUi: AppExtension = {
  id: layerNamesExtension.id,
};
