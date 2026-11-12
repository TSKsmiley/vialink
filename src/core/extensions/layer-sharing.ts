// SPDX-License-Identifier: GPL-2.0-or-later
// "Layer copy and sharing": copy, paste, duplicate, swap and clear layers, and
// share a layer as a line of text (src/core/layers.ts, src/core/layer-share.ts).
// A ViaLink extra that works with standard Vial firmware: it only uses the
// standard keymap commands, so the probe never talks to the board. It is an
// extension only so it can be turned off in the Extensions dialog.

import type { KeyboardExtension } from "./types.ts";

export const layerSharingExtension: KeyboardExtension<Record<string, never>> = {
  id: "layer-sharing",
  group: "compatible",
  name: "Layer copy and sharing",
  description:
    "Copy, paste, duplicate and swap layers, and share a layer as a line of text that a friend can paste onto the same kind of keyboard, even with other layout options.",
  async probe() {
    return {};
  },
};
