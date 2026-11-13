// SPDX-License-Identifier: GPL-2.0-or-later
// Layer copy and sharing's entries in the layer card's ⋯ menu, as commands
// (plan doc, "User interface"). The keymap view does the work (clipboard,
// paste preview, share text); these say what the menu shows.

import { layerSharingExtension } from "../../core/extensions/layer-sharing.ts";
import type { AppExtension } from "./registry.tsx";

export const layerSharingUi: AppExtension = {
  id: layerSharingExtension.id,
  layerCommands: [
    {
      id: "copy",
      title: "Copy layer",
      shortcut: "Ctrl+C",
      shortcutHandledByView: true, // also copies just the selected keys
      section: "layer",
      run: (layer, env) => env.copy(layer),
    },
    {
      id: "paste",
      title: "Paste onto this layer…",
      shortcut: "Ctrl+V",
      shortcutHandledByView: true, // shared layer text pastes from anywhere
      section: "layer",
      enabled: (_layer, env) => !!env.paste,
      run: (layer, env) => env.paste?.(layer),
    },
    {
      id: "duplicate",
      title: "Duplicate to empty layer",
      section: "layer",
      enabled: (_layer, env) => env.canDuplicate,
      run: (layer, env) => env.duplicate(layer),
    },
    {
      id: "swap",
      title: "Swap with…",
      section: "layer",
      choices: (layer, env) =>
        Array.from({ length: env.layerCount }, (_, l) => l)
          .filter((l) => l !== layer)
          .map((l) => ({ label: `${l} · ${env.layerName(l)}`, value: l })),
      run: (layer, env, other) => {
        if (other !== undefined) env.swap(layer, other);
      },
    },
    {
      id: "copy-text",
      title: "Copy layer as text",
      shortcut: "Ctrl+Shift+C",
      shortcutHandledByView: true, // skipped while typing in a field
      section: "text",
      run: (layer, env) => env.copyAsText(layer),
    },
    {
      id: "paste-text",
      title: "Paste layer from text…",
      section: "text",
      run: (_layer, env) => env.pasteFromText(),
    },
    {
      id: "clear",
      title: (layer) => `Clear layer (${layer === 0 ? "all empty" : "all transparent"})`,
      section: "clear",
      danger: true,
      run: (layer, env) => env.clear(layer),
    },
  ],
};
