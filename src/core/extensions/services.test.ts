// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import { installMacroSimulator } from "../sim/macros.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../sim/tap-dance.ts";
import { RequestQueue } from "../transport/queue.ts";
import { BUILTIN_EXTENSIONS } from "./index.ts";
import { macrosExtension } from "./macros.ts";
import { defineService, keycodeDescriptions, layerNames, provide } from "./services.ts";
import type { DeviceContext, KeyboardExtension } from "./types.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

async function load(
  extensions?: readonly KeyboardExtension<unknown>[],
  layerNamesOnBoard: string[] | null = null,
) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    layerNames: layerNamesOnBoard,
    dynamic: { tapDance: 2, combo: 0, keyOverride: 0, altRepeatKey: 0, featureFlags: 0 },
  });
  installTapDanceSimulator(sim, { count: 2, entries: [{ onTap: 0x04, onHold: 0xe1 }] });
  installMacroSimulator(sim, { count: 2, memory: 64 });
  await sim.open();
  sim.unlocked = true;
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions });
}

const greeter = defineService<{ hello(): string }>("greeter.hello");

function ext(
  id: string,
  manifest: Partial<Pick<KeyboardExtension, "requires" | "optional" | "provides">> = {},
  seen?: { ctx?: DeviceContext },
): KeyboardExtension<unknown> {
  return {
    id,
    name: id,
    description: "",
    group: "compatible",
    ...manifest,
    async probe(ctx) {
      if (seen) seen.ctx = ctx as DeviceContext;
      return { id };
    },
  };
}

describe("services", () => {
  it("describe tap dances and macros through the extensions that own them", async () => {
    const kb = await load();
    const [macros, td] = kb.provided(keycodeDescriptions); // registry order
    const code = (name: string) => kb.keycodes.parse(name);
    expect(td.describe(code("TD(0)"))).toEqual({ text: "Tap A · Hold LShift", empty: false });
    expect(td.describe(code("TD(1)"))).toEqual({ text: null, empty: true });
    expect(td.describe(code("M0"))).toBeNull();
    expect(macros.describe(code("M1"))).toEqual({ text: null, empty: true });

    await kb.extension(macrosExtension)!.setMacros([[{ type: "text", text: "hi" }], []]);
    expect(macros.describe(code("M0"))).toEqual({ text: 'text "hi"', empty: false });
  });

  it("supply layer names from the layer names extension", async () => {
    const kb = await load(BUILTIN_EXTENSIONS, ["Base", ""]);
    const [names] = kb.provided(layerNames);
    expect([names.name(0), names.name(1)]).toEqual(["Base", null]);
    const none = await load(BUILTIN_EXTENSIONS, null);
    expect(none.provided(layerNames)).toEqual([]);
  });

  it("reach other extensions only through requires or optional", async () => {
    const provider = ext("greeter", { provides: [provide(greeter, () => ({ hello: () => "hi" }))] });
    const user: { ctx?: DeviceContext } = {};
    const stranger: { ctx?: DeviceContext } = {};
    const kb = await load([
      provider,
      ext("user", { optional: ["greeter"] }, user),
      ext("stranger", {}, stranger),
    ]);
    expect(user.ctx!.use(greeter)?.hello()).toBe("hi");
    expect(() => stranger.ctx!.use(greeter)).toThrow(
      'stranger uses greeter.hello without listing "greeter" in requires or optional.',
    );
    // Core services need no declaration; a provider that stops running is gone.
    expect(stranger.ctx!.use(layerNames)).toBeNull();
    await kb.setExtensionEnabled(provider, false);
    expect(user.ctx!.use(greeter)).toBeNull();
  });
});
