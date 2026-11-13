// SPDX-License-Identifier: GPL-2.0-or-later
// Layer names, as the dynamic-layer-names branch of Theis194/vial-gui
// (protocol/layer_name.py) and its firmware implement them:
// - get: FE 0D 09 <layer> → status (0 = ok), 16 bytes NUL-padded UTF-8;
// - set: FE 0D 0A <layer> <16 bytes> → status; needs an unlocked board;
// - .vil: a "layer_names" list, one string per layer.
// Stock vial.c has no default case for unknown dynamic sub-commands and leaves
// the reply untouched (0xFE in byte 0), so a status of 0 means "supported".

import { normalizeLayerName, vialGetLayerName, vialSetLayerName } from "../protocol/commands.ts";
import {
  CMD_VIA_VIAL_PREFIX,
  CMD_VIAL_DYNAMIC_ENTRY_OP,
  DYNAMIC_VIAL_LAYER_NAME_GET,
  DYNAMIC_VIAL_LAYER_NAME_SET,
  VIAL_PROTOCOL_DYNAMIC,
} from "../protocol/constants.ts";
import { layerClear, layerSwap } from "../layers.ts";
import { on } from "./hooks.ts";
import type { DeviceContext, KeyboardExtension } from "./types.ts";

export class LayerNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerNameError";
  }
}

export class LayerNames {
  private readonly ctx: DeviceContext;
  private readonly values: string[];

  constructor(ctx: DeviceContext, names: string[]) {
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
    const { board, device } = this.ctx;
    if (layer < 0 || layer >= board.layers) throw new LayerNameError(`layer ${layer} does not exist`);
    const wanted = normalizeLayerName(name);
    const old = this.get(layer);
    if (wanted === old) return;
    await device.ensureUnlocked("Renaming a layer");
    const reply = vialSetLayerName.decode(await device.request(vialSetLayerName.encode(layer, wanted)));
    if (!reply.ok) throw new LayerNameError(`the keyboard rejected the layer name (status ${reply.status})`);
    const check = vialGetLayerName.decode(await device.request(vialGetLayerName.encode(layer)));
    if (!check.ok || check.name !== wanted) {
      throw new LayerNameError(`layer name did not verify: sent "${wanted}", read back "${check.name}"`);
    }
    this.values[layer] = wanted;
    this.ctx.history.record({
      label: old ? `Rename layer ${layer} from “${old}” to “${wanted}”` : `Name layer ${layer} “${wanted}”`,
      undo: () => this.set(layer, old),
      redo: () => this.set(layer, wanted),
      isCurrent: () => this.get(layer) === wanted,
    });
    this.ctx.changed();
  }
}

export const layerNamesExtension: KeyboardExtension<LayerNames> = {
  id: "layer-names",
  name: "Layer names",
  description:
    "Names for layers, stored on the board. Needs firmware with the Theis194 dynamic-layer-names extension.",
  group: "nonstandard",
  firmware: { label: "Theis194/vial-qmk", url: "https://github.com/Theis194/vial-qmk" },
  commands: [
    {
      name: "Get layer name",
      kind: "read",
      bytes: [CMD_VIA_VIAL_PREFIX, CMD_VIAL_DYNAMIC_ENTRY_OP, DYNAMIC_VIAL_LAYER_NAME_GET],
      reply: vialGetLayerName.decode,
      describe: (request) => `Get layer name ${request[3] ?? 0}`,
    },
    {
      name: "Set layer name",
      kind: "write",
      bytes: [CMD_VIA_VIAL_PREFIX, CMD_VIAL_DYNAMIC_ENTRY_OP, DYNAMIC_VIAL_LAYER_NAME_SET],
      reply: vialSetLayerName.decode,
      describe: (request) => `Set layer name ${request[3] ?? 0}`,
    },
  ],

  async probe(ctx) {
    const { board, device } = ctx;
    if (board.vialProtocol < VIAL_PROTOCOL_DYNAMIC || board.layers === 0) return null;
    const first = vialGetLayerName.decode(await device.request(vialGetLayerName.encode(0), { retries: 3 }));
    if (!first.ok) return null;
    const names = [first.name];
    for (let layer = 1; layer < board.layers; layer++) {
      const reply = vialGetLayerName.decode(await device.request(vialGetLayerName.encode(layer)));
      names.push(reply.ok ? reply.name : "");
    }
    return new LayerNames(ctx, names);
  },

  hooks: [
    // A cleared layer loses its name too, so it reads as empty again.
    on(layerClear.after, (e, _ctx, names: LayerNames) => names.set(e.layer, "")),
    // Names move with the keys.
    on(layerSwap.after, async (e, _ctx, names: LayerNames) => {
      const [na, nb] = [names.get(e.a), names.get(e.b)];
      if (na === nb) return;
      await names.set(e.a, nb);
      await names.set(e.b, na);
    }),
  ],

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
