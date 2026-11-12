// SPDX-License-Identifier: GPL-2.0-or-later
// The demo keyboard: every built-in extension should find its feature on it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_EXTENSIONS } from "../core/extensions/index.ts";
import { Keyboard } from "../core/keyboard.ts";
import { RequestQueue } from "../core/transport/queue.ts";
import { demoTransport } from "./connection.ts";

afterEach(() => vi.unstubAllGlobals());

describe("demo keyboard", () => {
  it("activates every built-in extension", async () => {
    const definition = readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz"));
    vi.stubGlobal("fetch", async () => new Response(definition));
    const transport = await demoTransport();
    await transport.open();
    const kb = await Keyboard.load(new RequestQueue(transport, { retryDelayMs: 0 }));
    const active = kb.activeExtensions.map((a) => a.extension.id).sort();
    expect(active).toEqual(BUILTIN_EXTENSIONS.map((e) => e.id).sort());
  });
});
