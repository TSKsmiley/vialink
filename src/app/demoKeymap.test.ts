// SPDX-License-Identifier: GPL-2.0-or-later
// The demo's starter keymap lands on keys the KLOR draws. Its right half was
// once a column off, which left P on a matrix position the layout doesn't draw.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { Keyboard } from "../core/keyboard.ts";
import { keyBoxes } from "../core/keyPaste.ts";
import { SimulatedKeyboard } from "../core/sim/simulatedKeyboard.ts";
import { RequestQueue } from "../core/transport/queue.ts";
import { demoKeymap } from "./demoKeymap.ts";

it("puts every starter key on a key the KLOR draws, and every letter on Base", async () => {
  const { keymap, encoders } = demoKeymap();
  const sim = new SimulatedKeyboard({
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    keymap,
    encoderCount: 2,
    encoders,
  });
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
  const drawn = new Set(
    keyBoxes(kb).flatMap((e) => (e.target.kind === "key" ? [`${e.target.row},${e.target.col}`] : [])),
  );

  for (let layer = 0; layer < 4; layer++)
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 6; col++) {
        const code = sim.getKeycode(layer, row, col);
        if (!drawn.has(`${row},${col}`)) expect(code, `layer ${layer} key ${row},${col}`).toBe(0);
        else if (layer === 0) expect(code, `Base key ${row},${col}`).not.toBe(0);
      }

  const base = [...drawn].map((p) => kb.keycodes.serialize(kb.getKey(0, +p[0], +p[2]) ?? 0));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(base).toContain(`KC_${letter}`);
  expect(base).toContain("LT1(KC_SPACE)");
  expect(kb.keycodes.serialize(kb.getEncoder(0, 0, 1) ?? 0)).toBe("KC_VOLU");
});
