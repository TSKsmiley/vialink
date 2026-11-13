// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { BUILTIN_EXTENSIONS } from "./index.ts";
import {
  dependencyOrder,
  findCycle,
  manifestProblems,
  requiredBy,
  requirementsOf,
  resolveActive,
} from "./manifest.ts";
import { vialGetKeyboardId } from "../protocol/commands.ts";
import { ExtensionCommandError, type DeviceContext, type KeyboardExtension } from "./types.ts";

type Fake = KeyboardExtension<unknown> & { probes: number };

/** A fake extension; `supported: false` makes its probe say no. */
function ext(
  id: string,
  manifest: Partial<Pick<KeyboardExtension, "requires" | "optional" | "provides" | "conflicts">> = {},
  supported = true,
  seen?: string[],
): Fake {
  const fake: Fake = {
    id,
    name: id,
    description: "",
    group: "compatible",
    ...manifest,
    probes: 0,
    async probe() {
      fake.probes++;
      seen?.push(id);
      return supported ? { id } : null;
    },
  };
  return fake;
}

const ids = (exts: readonly { id: string }[]) => exts.map((e) => e.id);

describe("built-in extension manifests", () => {
  it("name only known extensions, provide prefixed ids and have no dependency cycle", () => {
    expect(manifestProblems(BUILTIN_EXTENSIONS)).toEqual([]);
  });
});

describe("manifest checks", () => {
  it("finds a cycle of requires and optional", () => {
    const a = ext("a", { requires: ["b"] });
    const b = ext("b", { optional: ["c"] });
    const c = ext("c", { requires: ["a"] });
    expect(findCycle([a, b, c])).toEqual(["a", "b", "c", "a"]);
    expect(findCycle([a, b])).toBeNull();
    expect(() => dependencyOrder([a, b, c])).toThrow("a → b → c → a");
    expect(manifestProblems([a, b, c])).toContain("Dependency cycle: a → b → c → a.");
  });

  it("reports unknown, self and contradictory references and badly named services", () => {
    const problems = manifestProblems([
      ext("a", { requires: ["ghost", "b"], conflicts: ["b", "a"], provides: [{ id: "b.thing" }] }),
      ext("b", { provides: [{ id: "b.thing" }, { id: "b.thing" }] }),
    ]);
    expect(problems).toEqual([
      'a: requires names unknown extension "ghost".',
      "a: conflicts names itself.",
      'a: both requires and conflicts with "b".',
      'a: provided "b.thing" must start with "a.".',
      '"b.thing" is provided twice.',
      '"b.thing" is provided twice.',
    ]);
  });

  it("orders dependencies first and keeps the given order otherwise", () => {
    const order = dependencyOrder([
      ext("names", { optional: ["sharing"] }),
      ext("macros"),
      ext("whole-keymap", { requires: ["sharing"] }),
      ext("sharing"),
    ]);
    expect(ids(order)).toEqual(["sharing", "names", "macros", "whole-keymap"]);
  });

  it("follows requirements both ways, transitively", () => {
    const all = [
      ext("a"),
      ext("b", { requires: ["a"] }),
      ext("c", { requires: ["b"] }),
      ext("d", { optional: ["a"] }),
    ];
    expect(ids(requiredBy("a", all))).toEqual(["b", "c"]);
    expect(ids(requirementsOf("c", all))).toEqual(["b", "a"]);
  });
});

describe("resolveActive", () => {
  const status = (exts: Fake[], unsupported: string[] = [], recency: Record<string, number> = {}) =>
    Object.fromEntries(
      resolveActive(
        dependencyOrder(exts),
        (id) => !unsupported.includes(id),
        (id) => recency[id] ?? 0,
      ),
    );

  it("keeps an extension off when a requirement is unsupported or switched off", () => {
    const sharing = ext("sharing");
    const whole = ext("whole", { requires: ["sharing"] });
    const deep = ext("deep", { requires: ["whole"] });
    expect(status([sharing, whole, deep], ["sharing"])).toEqual({
      sharing: { kind: "unsupported" },
      whole: { kind: "needs", ids: ["sharing"] },
      deep: { kind: "needs", ids: ["whole"] },
    });
    expect(status([whole])).toEqual({ whole: { kind: "needs", ids: ["sharing"] } });
    // optional dependencies never keep anything off
    expect(status([ext("names", { optional: ["sharing"] })])).toEqual({ names: { kind: "active" } });
  });

  it("settles a conflict by the most recent turn-on, else the extension already there", () => {
    const macros = ext("macros");
    const recorder = ext("recorder", { conflicts: ["macros"] });
    expect(status([macros, recorder])).toEqual({
      macros: { kind: "active" },
      recorder: { kind: "conflict", with: "macros" },
    });
    expect(status([macros, recorder], [], { recorder: 2, macros: 1 })).toEqual({
      macros: { kind: "conflict", with: "recorder" },
      recorder: { kind: "active" },
    });
    // No conflict when the keyboard doesn't support the other one.
    expect(status([macros, recorder], ["macros"])).toEqual({
      macros: { kind: "unsupported" },
      recorder: { kind: "active" },
    });
  });

  it("turns off the extensions that need a conflict's loser", () => {
    const macros = ext("macros");
    const editor = ext("editor", { requires: ["macros"] });
    const recorder = ext("recorder", { conflicts: ["macros"] });
    expect(status([macros, editor, recorder], [], { recorder: 1 })).toEqual({
      macros: { kind: "conflict", with: "recorder" },
      editor: { kind: "needs", ids: ["macros"] },
      recorder: { kind: "active" },
    });
  });
});

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

async function load(extensions: Fake[], recency?: (id: string) => number) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), { extensions, recency });
}

describe("keyboard probing with dependencies", () => {
  it("probes dependencies first and skips those whose requirement the board lacks", async () => {
    const seen: string[] = [];
    const whole = ext("whole", { requires: ["sharing"] }, true, seen);
    const names = ext("names", { optional: ["sharing"] }, true, seen);
    const sharing = ext("sharing", {}, true, seen);
    const kb = await load([whole, names, sharing]);
    expect(seen).toEqual(["sharing", "whole", "names"]);
    expect(ids(kb.activeExtensions.map((a) => a.extension))).toEqual(["sharing", "whole", "names"]);

    const seen2: string[] = [];
    const lacking = await load([
      ext("whole", { requires: ["sharing"] }, true, seen2),
      ext("sharing", {}, false, seen2),
    ]);
    expect(seen2).toEqual(["sharing"]);
    expect(lacking.extensionStatus("whole")).toEqual({ kind: "needs", ids: ["sharing"] });
    expect(lacking.extensionStatus("sharing")).toEqual({ kind: "unsupported" });
    expect(lacking.extensionStatus("nothing")).toEqual({ kind: "off" });
  });

  it("turns dependents off with their requirement and back on with it", async () => {
    const sharing = ext("sharing");
    const whole = ext("whole", { requires: ["sharing"] });
    const kb = await load([sharing, whole]);
    expect(await kb.setExtensionEnabled(sharing, false)).toBe(false);
    expect(kb.extensionStatus("whole")).toEqual({ kind: "needs", ids: ["sharing"] });
    expect(kb.activeExtensions).toEqual([]);
    expect(await kb.setExtensionEnabled(sharing, true)).toBe(true);
    expect(kb.extensionStatus("whole")).toEqual({ kind: "active" });
  });

  it("runs the most recently turned on of two conflicting extensions", async () => {
    const turnedOn: Record<string, number> = {};
    const macros = ext("macros");
    const recorder = ext("recorder", { conflicts: ["macros"] });
    const kb = await load([macros, recorder], (id) => turnedOn[id] ?? 0);
    expect(kb.extensionStatus("recorder")).toEqual({ kind: "conflict", with: "macros" });

    // Turning macros off lets the recorder run; macros on again by hand wins.
    await kb.setExtensionEnabled(macros, false);
    expect(kb.extensionStatus("recorder")).toEqual({ kind: "active" });
    turnedOn.macros = 1;
    await kb.setExtensionEnabled(macros, true);
    expect(kb.extensionStatus("recorder")).toEqual({ kind: "conflict", with: "macros" });
    expect(ids(kb.activeExtensions.map((a) => a.extension))).toEqual(["macros"]);
  });

  it("checks support without turning an extension on, probing once", async () => {
    const kb = await load([]);
    const other = ext("other", {}, false);
    expect(await kb.supportsExtension(other)).toBe(false);
    expect(await kb.supportsExtension(other)).toBe(false);
    expect(other.probes).toBe(1);
    expect(kb.extensionStatus("other")).toEqual({ kind: "off" });
  });
});

describe("extension groups limit device access", () => {
  const layerNameGet = Uint8Array.of(0xfe, 0x0d, 0x09, 0);

  async function contextOf(extension: KeyboardExtension<unknown>) {
    let seen: unknown = null;
    const spy = {
      ...extension,
      async probe(ctx: unknown) {
        seen = ctx;
        return {};
      },
    } as KeyboardExtension<unknown>;
    const kb = await load([spy as Fake]);
    return { kb, ctx: seen as DeviceContext };
  }

  it("gives a compatible extension no device at all", async () => {
    const { ctx } = await contextOf(ext("extra"));
    expect("device" in ctx).toBe(false);
    expect(ctx.board.layers).toBe(2);
  });

  it("lets a standard extension send only standard Vial commands", async () => {
    const { ctx } = await contextOf({ ...ext("feature"), group: "standard" } as KeyboardExtension<unknown>);
    expect((await ctx.device.request(vialGetKeyboardId.encode())).length).toBeGreaterThan(0);
    await expect(ctx.device.request(layerNameGet)).rejects.toThrow(ExtensionCommandError);
    await expect(ctx.device.request(layerNameGet)).rejects.toThrow(
      "feature tried to send a command it hasn't declared (fe 0d 09 …); nothing was sent.",
    );
  });

  it("lets a non-standard extension send the custom commands it declares", async () => {
    const { ctx } = await contextOf({
      ...ext("fork"),
      group: "nonstandard",
      firmware: { label: "fork", url: "https://example.invalid" },
      commands: [{ name: "Get layer name", kind: "read", bytes: [0xfe, 0x0d, 0x09], reply: (r) => r }],
    } as KeyboardExtension<unknown>);
    await expect(ctx.device.request(layerNameGet)).resolves.toBeInstanceOf(Uint8Array);
    await expect(ctx.device.request(Uint8Array.of(0xfe, 0x0d, 0x0a, 0))).rejects.toThrow(
      ExtensionCommandError,
    );
  });

  it("prefixes notices with the extension's name", async () => {
    const { kb, ctx } = await contextOf(ext("Key notes"));
    const got: string[] = [];
    kb.notifyHandler = (kind, message) => got.push(`${kind}: ${message}`);
    ctx.notify.info("Saved 3 labels");
    ctx.notify.error("No room");
    expect(got).toEqual(["info: Key notes: Saved 3 labels", "error: Key notes: No room"]);
  });

  it("reports manifests that don't fit their group", () => {
    const fork = {
      ...ext("fork"),
      group: "nonstandard",
      firmware: { label: "fork", url: "https://example.invalid" },
      commands: [{ name: "Get keyboard id", kind: "read", bytes: [0xfe, 0x00], reply: (r: Uint8Array) => r }],
    } as KeyboardExtension<unknown>;
    const empty = { ...fork, id: "empty", commands: [] } as KeyboardExtension<unknown>;
    expect(manifestProblems([fork, empty])).toEqual([
      'fork: "Get keyboard id" is a standard Vial command; don\'t declare it.',
      "empty: non-standard but declares no custom commands.",
    ]);
  });
});
