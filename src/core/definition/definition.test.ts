// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeDefinition,
  DefinitionError,
  extractPhysicalLayout,
  validateDefinition,
} from "./definition.ts";
import { placeLayout } from "./geometry.ts";
import { deserializeKle } from "./kle.ts";
import { packLayoutOptions, unpackLayoutOptions } from "./layoutOptions.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/definitions/${name}`, import.meta.url)));
const json = (name: string) => JSON.parse(new TextDecoder().decode(fixture(name)));

describe("definition pipeline", () => {
  it("decompresses and parses the KLOR definition", async () => {
    const def = await decodeDefinition(fixture("klor.vial.json.xz"));
    expect(def).toEqual(json("klor.vial.json"));
    const layout = extractPhysicalLayout(def);
    expect(layout.keys.every((k) => k.row < 8 && k.col < 6)).toBe(true);
    // Rotated thumb clusters.
    expect(layout.keys.some((k) => k.rotationAngle !== 0)).toBe(true);
    // One layout option ("Layout size") with four choices; Saegewerk (3) adds no keys of its own,
    // so only variants 0-2 appear as tags in the file.
    expect(def.layouts.labels).toEqual([["Layout size", "Polydactyl ", "Konrad", "Yubitsume", "Saegewerk"]]);
    expect(new Set(layout.keys.filter((k) => k.layoutIndex === 0).map((k) => k.layoutOption))).toEqual(
      new Set([0, 1, 2]),
    );
  });

  it("places each KLOR layout variant at the origin of variant 0", () => {
    const def = validateDefinition(json("klor.vial.json"));
    const { keys, encoders } = extractPhysicalLayout(def);
    const sizes = [0, 1, 2, 3].map((v) => {
      const placed = placeLayout(keys, encoders, [v]);
      expect(placed.keys.every((p) => p.shape.layoutIndex === -1 || p.shape.layoutOption === v)).toBe(true);
      return placed.keys.length;
    });
    expect(Math.min(...sizes)).toBeGreaterThan(30);
  });

  it("finds encoders and the ISO Enter second rectangle on the Keychron Q10", () => {
    const { keys, encoders, encoderCount } = extractPhysicalLayout(
      validateDefinition(json("keychron_q10_iso_encoder.vial.json")),
    );
    expect(encoderCount).toBeGreaterThan(0);
    expect(encoders.filter((e) => e.direction === 0).length).toBe(
      encoders.filter((e) => e.direction === 1).length,
    );
    expect(keys.some((k) => k.height > 1 && (k.x2 !== 0 || k.width2 !== k.width))).toBe(true);
  });

  it("rejects bad input with readable errors", async () => {
    await expect(decodeDefinition(new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toBeInstanceOf(
      DefinitionError,
    );
    expect(() => validateDefinition({ layouts: { keymap: [] } })).toThrow(/matrix/);
    expect(() =>
      extractPhysicalLayout(
        validateDefinition({ matrix: { rows: 1, cols: 1 }, layouts: { keymap: [["0,5"]] } }),
      ),
    ).toThrow(/matrix declares/);
  });
});

describe("KLE parser", () => {
  it("handles widths, rotation clusters and label alignment", () => {
    const keys = deserializeKle([
      [{ w: 1.5 }, "0,0", "0,1"],
      [{ r: 15, rx: 3, ry: 1, y: -1 }, "1,0"],
      [{ a: 7 }, "1,1\n\n\n\n\n\n\n\n\ne"],
    ]);
    expect(keys[0]).toMatchObject({ x: 0, width: 1.5, labels: expect.arrayContaining(["0,0"]) });
    expect(keys[1]).toMatchObject({ x: 1.5, width: 1 });
    expect(keys[2]).toMatchObject({ rotationAngle: 15, rotationX: 3, rotationY: 1, x: 3, y: 0 });
    // Default alignment 4 puts the 10th line in slot 4: the encoder marker vial-gui looks for.
    const enc = deserializeKle([["0,0\n\n\n\n\n\n\n\n\ne"]])[0];
    expect(enc.labels[4]).toBe("e");
  });
});

describe("layout options packing", () => {
  const labels = ["Split backspace", ["Bottom row", "ANSI", "Tsangan", "WKL"], ["Enter", "ANSI", "ISO"]];
  it("packs the first label into the most significant bits", () => {
    // 1 bit + 2 bits + 1 bit: split=1, bottom=2, enter=1 → 1 10 1
    expect(packLayoutOptions([1, 2, 1], labels)).toBe(0b1101);
    expect(unpackLayoutOptions(0b1101, labels)).toEqual([1, 2, 1]);
  });
  it("round-trips every combination", () => {
    for (let v = 0; v < 16; v++) expect(packLayoutOptions(unpackLayoutOptions(v, labels), labels)).toBe(v);
  });
});
