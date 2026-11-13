// SPDX-License-Identifier: GPL-2.0-or-later
// "Layer copy and sharing": copy, paste, duplicate, swap and clear layers, and
// share a layer as a line of text (src/core/layers.ts, src/core/layer-share.ts).
// A ViaLink extra that works with standard Vial firmware: it only uses the
// standard keymap commands, so the probe never talks to the board. It is an
// extension so it can be turned off in the Extensions dialog, and so others can
// join in through its two hook points:
// - layer-sharing.paste: paste, duplicate and paste from text, as one
//   operation (before/filter/after; layer names names the target);
// - layer-sharing.share-text: extensions add their own data to a copied layer
//   (in-app copy and share text), read back as the paste event's `ext`.

import { paste, shareText } from "./layer-sharing.api.ts";
import type { KeyboardExtension } from "./types.ts";

export const layerSharingExtension: KeyboardExtension<Record<string, never>> = {
  id: "layer-sharing",
  group: "compatible",
  provides: [paste, shareText],
  name: "Layer copy and sharing",
  description:
    "Copy, paste, duplicate and swap layers, and share a layer as a line of text that a friend can paste onto the same kind of keyboard, even with other layout options.",
  async probe() {
    return {};
  },
};
