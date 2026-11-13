// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import { KC_TRNS, visiblePositions } from "./layerInfo.ts";
import {
  SHARE_MAX_LENGTH,
  ShareError,
  decodeLayer,
  encodeLayer,
  isShareText,
  matchShared,
} from "./layer-share.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";

/** Written by ViaLink's first share format; must keep decoding forever. */
const FORMAT_1_SAMPLE =
  "vialink:layer:1:klor:LcuxCsIwFAXQXyl3vkPTpG3Mpo5KcQ8PiZpBmpqhVYjFfxfB8QxnxXiB88psaktFKNU0WhvTtl3X99ZCiJThvMcxlPxcqvn-jiBOOZVbuC4lVRAhHmGKcBjCC8QYy_w7NTVx2J-3EHrzxw4iny8";

async function klor(info?: { vendorId: number; productId: number }, uid?: bigint) {
  const sim = new SimulatedKeyboard({
    info: { productName: "Klor", vendorId: info?.vendorId ?? 0x3a3c, productId: info?.productId ?? 0x0001 },
    compressedDefinition: new Uint8Array(
      readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
    ),
    rows: 8,
    cols: 6,
    layers: 4,
    ...(uid !== undefined ? { uid } : {}),
  });
  await sim.open();
  return Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }));
}

describe("layer share text", () => {
  it("round-trips a layer: keys, encoders, name, layout, references", async () => {
    const kb = await klor();
    const [p, q] = visiblePositions(kb);
    for (const pos of kb.matrixPositions) await kb.setKey(1, pos.row, pos.col, KC_TRNS);
    await kb.setKey(1, p.row, p.col, kb.keycodes.parse("LT(2, KC_SPACE)"));
    await kb.setKey(1, q.row, q.col, kb.keycodes.parse("TD(0)"));
    if (kb.encoderIndices.length)
      await kb.setEncoder(1, kb.encoderIndices[0], 1, kb.keycodes.parse("KC_VOLU"));

    const text = await encodeLayer(kb, 1, { "layer-names": { name: "Nav" } });
    expect(text).toMatch(/^vialink:layer:1:klor:[A-Za-z0-9_-]+$/);
    expect(isShareText(`  ${text}\n`)).toBe(true);

    const shared = await decodeLayer(text);
    expect(shared.ext).toEqual({ "layer-names": { name: "Nav" } });
    expect(shared.keys).toEqual([
      { row: p.row, col: p.col, id: kb.keycodes.serialize(kb.keycodes.parse("LT(2, KC_SPACE)")) },
      { row: q.row, col: q.col, id: "TD(0)" },
    ]);
    expect(shared.tapDances).toEqual([0]);

    const match = matchShared(kb, shared, { tapDanceEmpty: () => true });
    expect(match.sameLayout).toBe(true);
    expect(match.unplaced).toEqual([]);
    expect(match.emptyTapDances).toEqual([0]);
    expect(match.snapshot.keys.get(`${p.row},${p.col}`)).toBe(kb.keycodes.parse("LT(2, KC_SPACE)"));
    // Keys the text does not have are transparent, so "replace" makes an exact copy.
    expect([...match.snapshot.keys.values()].filter((c) => c === KC_TRNS).length).toBe(
      visiblePositions(kb).length - 2,
    );
    if (kb.encoderIndices.length) {
      expect(match.snapshot.encoders.get(`${kb.encoderIndices[0]},1`)).toBe(kb.keycodes.parse("KC_VOLU"));
    }
  });

  it("matches by matrix position across layout options and lists keys with no spot", async () => {
    const kb = await klor();
    const before = new Set(visiblePositions(kb).map((p) => `${p.row},${p.col}`));
    for (const p of visiblePositions(kb)) await kb.setKey(0, p.row, p.col, 0x04);
    const text = await encodeLayer(kb, 0);

    // Another layout option on the receiving end (same keyboard).
    const labels = kb.layoutLabels ?? [];
    const other = Array.isArray(labels[0]) && labels[0].length > 2 ? 2 : 1;
    await kb.setLayoutChoices([other]);
    const after = new Set(visiblePositions(kb).map((p) => `${p.row},${p.col}`));
    const gone = [...before].filter((id) => !after.has(id));
    expect(gone.length).toBeGreaterThan(0); // the fixture's layouts really differ

    const match = matchShared(kb, await decodeLayer(text));
    expect(match.sameLayout).toBe(false);
    expect(match.unplaced.map((u) => `${u.row},${u.col}`).sort()).toEqual(gone.sort());
    for (const id of after) {
      const code = match.snapshot.keys.get(id);
      expect(code === 0x04 || code === KC_TRNS).toBe(true);
    }
  });

  it("keeps reading format 1 texts (backwards compatibility)", async () => {
    // A format 1 text as ViaLink wrote it on 12 Nov 2026 (KLOR, layer "Nav", two keys).
    // If this fails, a change broke texts people already shared: add a new format version instead.
    const kb = await klor();
    const [p, q] = visiblePositions(kb);
    for (const pos of kb.matrixPositions) await kb.setKey(1, pos.row, pos.col, KC_TRNS);
    await kb.setKey(1, p.row, p.col, 0x04);
    await kb.setKey(1, q.row, q.col, 0x05);
    const text = await encodeLayer(kb, 1, { "layer-names": { name: "Nav" } });
    expect(text.startsWith("vialink:layer:1:klor:")).toBe(true);
    expect(FORMAT_1_SAMPLE.startsWith("vialink:layer:1:")).toBe(true);
    const old = await decodeLayer(FORMAT_1_SAMPLE);
    expect(old.ext).toEqual({ "layer-names": { name: "Nav" } }); // read from the old top-level name
    expect(old.keys.map((k) => k.id)).toEqual(["KC_A", "KC_B"]);
  });

  it("refuses another keyboard, cut-off text and other versions", async () => {
    const kb = await klor();
    const text = await encodeLayer(kb, 0);
    const other = await klor({ vendorId: 0x1234, productId: 0x0001 });
    await expect(decodeLayer(text).then((s) => matchShared(other, s))).rejects.toThrow(/another keyboard/);
    const otherUid = await klor(undefined, 0x1122334455667799n);
    await expect(decodeLayer(text).then((s) => matchShared(otherUid, s))).rejects.toThrow(/another keyboard/);

    await expect(decodeLayer(text.slice(0, -12))).rejects.toThrow(/cut off/);
    await expect(decodeLayer(text.replace(":1:", ":2:"))).rejects.toThrow(/newer ViaLink/);
    await expect(decodeLayer(text.replace(":1:", ":x:"))).rejects.toThrow(/not a shared ViaLink layer/);
    await expect(decodeLayer("hello")).rejects.toThrow(ShareError);
    await expect(decodeLayer("vialink:layer:1:klor")).rejects.toThrow(/not complete/);
  });

  it("keeps a worst-case KLOR layer under the Discord limit", async (ctx) => {
    const kb = await klor();
    // The layout option with the most keys.
    const labels = kb.layoutLabels ?? [];
    let best = kb.layoutChoices;
    let most = 0;
    const choices = Array.isArray(labels[0]) ? labels[0].length - 1 : 2;
    for (let c = 0; c < choices; c++) {
      await kb.setLayoutChoices([c]);
      const n = visiblePositions(kb).length;
      if (n > most) {
        most = n;
        best = [c];
      }
    }
    await kb.setLayoutChoices(best);
    // Every key different, using the keycodes with the longest names (hardest to compress).
    const seen = new Set<string>();
    const longest = kb.keycodes
      .groups()
      .flatMap((g) => g.keycodes)
      .filter((k) => !k.masked && !seen.has(k.qmk_id) && seen.add(k.qmk_id))
      .sort((a, b) => b.qmk_id.length - a.qmk_id.length);
    let i = 0;
    for (const p of visiblePositions(kb)) await kb.setKey(0, p.row, p.col, longest[i++].value);
    for (const index of kb.encoderIndices) {
      await kb.setEncoder(0, index, 0, kb.keycodes.parse("KC_AUDIO_VOL_DOWN"));
      await kb.setEncoder(0, index, 1, kb.keycodes.parse("KC_AUDIO_VOL_UP"));
    }
    const text = await encodeLayer(kb, 0, { "layer-names": { name: "A long layer name" } });
    ctx.annotate(`worst case: ${text.length} characters for ${most} keys`);
    expect(text.length).toBeLessThanOrEqual(SHARE_MAX_LENGTH);
  });
});
