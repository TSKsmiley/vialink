// SPDX-License-Identifier: GPL-2.0-or-later
// Layer names, as the dynamic-layer-names branch of Theis194/vial-gui
// (protocol/layer_name.py) and its firmware implement them:
// - get: FE 0D 09 <layer> → status (0 = ok), 16 bytes NUL-padded UTF-8;
// - set: FE 0D 0A <layer> <16 bytes> → status; needs an unlocked board;
// - .vil: a "layer_names" list, one string per layer.
// Stock vial.c has no default case for unknown dynamic sub-commands and leaves
// the reply untouched (0xFE in byte 0), so a status of 0 means "supported".

import { normalizeLayerName, vialGetLayerName, vialSetLayerName } from "../protocol/commands.ts";
import { VIAL_PROTOCOL_DYNAMIC } from "../protocol/constants.ts";
import type { ExtensionContext, KeyboardExtension } from "./types.ts";

export class LayerNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerNameError";
  }
}

export class LayerNames {
  private readonly ctx: ExtensionContext;
  private readonly values: string[];

  constructor(ctx: ExtensionContext, names: string[]) {
    this.ctx = ctx;
    this.values = names;
  }

  get names(): readonly string[] {
    return this.values;
  }

  get(layer: number): string {
    return this.values[layer] ?? "";
  }

  /**
   * Writes a layer name, then reads it back to verify (as the fork's GUI does).
   * Needs an unlocked board; see Keyboard.ensureUnlocked.
   */
  async set(layer: number, name: string): Promise<void> {
    const { keyboard, queue } = this.ctx;
    if (layer < 0 || layer >= keyboard.layers) throw new LayerNameError(`layer ${layer} does not exist`);
    const wanted = normalizeLayerName(name);
    if (wanted === this.get(layer)) return;
    await keyboard.ensureUnlocked("Renaming a layer");
    const reply = vialSetLayerName.decode(await queue.request(vialSetLayerName.encode(layer, wanted)));
    if (!reply.ok) throw new LayerNameError(`the keyboard rejected the layer name (status ${reply.status})`);
    const check = vialGetLayerName.decode(await queue.request(vialGetLayerName.encode(layer)));
    if (!check.ok || check.name !== wanted) {
      throw new LayerNameError(`layer name did not verify: sent "${wanted}", read back "${check.name}"`);
    }
    this.values[layer] = wanted;
    this.ctx.changed();
  }
}

export const layerNamesExtension: KeyboardExtension<LayerNames> = {
  id: "layer-names",
  name: "Layer names",
  description:
    "Names for layers, stored on the keyboard. Needs firmware with the Theis194 dynamic-layer-names extension.",
  firmware: { label: "Theis194/vial-qmk", url: "https://github.com/Theis194/vial-qmk" },

  async probe(ctx) {
    const { keyboard, queue } = ctx;
    if (keyboard.vialProtocol < VIAL_PROTOCOL_DYNAMIC || keyboard.layers === 0) return null;
    const first = vialGetLayerName.decode(await queue.request(vialGetLayerName.encode(0), { retries: 3 }));
    if (!first.ok) return null;
    const names = [first.name];
    for (let layer = 1; layer < keyboard.layers; layer++) {
      const reply = vialGetLayerName.decode(await queue.request(vialGetLayerName.encode(layer)));
      names.push(reply.ok ? reply.name : "");
    }
    return new LayerNames(ctx, names);
  },

  vil: {
    keys: ["layer_names"],
    save: (state) => ({ layer_names: [...state.names] }),
    restore(state, file) {
      const names = file.layer_names;
      if (!Array.isArray(names)) return [];
      const steps = [];
      for (let layer = 0; layer < Math.min(names.length, state.names.length); layer++) {
        const name = names[layer];
        if (typeof name !== "string") continue;
        if (normalizeLayerName(name) === state.get(layer)) continue;
        steps.push({
          description: `Rename layer ${layer} to "${normalizeLayerName(name)}"`,
          apply: () => state.set(layer, name),
        });
      }
      return steps;
    },
  },
};
