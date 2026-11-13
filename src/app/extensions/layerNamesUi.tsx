// SPDX-License-Identifier: GPL-2.0-or-later
import { layerNamesExtension } from "../../core/extensions/layerNames.ts";
import type { AppExtension } from "./registry.tsx";

export const layerNamesUi: AppExtension = {
  id: layerNamesExtension.id,
  layerTabLabel(keyboard, layer) {
    const name = keyboard.extension(layerNamesExtension)?.get(layer);
    return name ? `${layer}: ${name}` : null;
  },
};
