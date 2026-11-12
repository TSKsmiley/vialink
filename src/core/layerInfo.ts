// SPDX-License-Identifier: GPL-2.0-or-later
// Facts about layers for the layer rail: how many keys a layer sets, and which
// keys reach it (MO, LT, TG, ...). ViaLink-only; vial-gui shows none of this.
// Layer keycodes are recognised by value through KeycodeTable.parse, so the
// v5 and v6 keycode layouts both work.

import type { KeycodeTable } from "./keycodes/table.ts";
import type { Keyboard } from "./keyboard.ts";
import type { PhysicalKey } from "./definition/definition.ts";

export type LayerAction = "MO" | "LT" | "TG" | "TO" | "TT" | "OSL" | "DF" | "PDF";

export interface LayerKey {
  action: LayerAction;
  layer: number;
  /** LT only: the keycode sent on tap. */
  tap?: number;
}

const SIMPLE: readonly LayerAction[] = ["MO", "TG", "TO", "TT", "OSL", "DF", "PDF"];
const cache = new WeakMap<KeycodeTable, { simple: Map<number, LayerKey>; lt: Map<number, number> }>();

function tables(table: KeycodeTable, layers: number) {
  let t = cache.get(table);
  if (t) return t;
  const simple = new Map<number, LayerKey>();
  const lt = new Map<number, number>(); // LT base (tap KC_NO) → layer
  for (let layer = 0; layer < Math.max(layers, 16); layer++) {
    for (const action of SIMPLE) {
      try {
        simple.set(table.parse(`${action}(${layer})`), { action, layer });
      } catch {
        // This firmware lacks the keycode (e.g. PDF before protocol 6).
      }
    }
    if (layer < 16) {
      try {
        lt.set(table.parse(`LT(${layer}, KC_NO)`), layer);
      } catch {
        // Older tables only have LT for some layers.
      }
    }
  }
  t = { simple, lt };
  cache.set(table, t);
  return t;
}

/** What a keycode does to layers, or null when it is not a layer key. */
export function layerKeyOf(table: KeycodeTable, layers: number, code: number): LayerKey | null {
  const t = tables(table, layers);
  const simple = t.simple.get(code);
  if (simple) return simple;
  const layer = t.lt.get(code & 0xff00);
  return layer === undefined ? null : { action: "LT", layer, tap: code & 0xff };
}

/** Keys on the chosen layout options, as drawn. */
export function visibleKeys(kb: Keyboard): PhysicalKey[] {
  const choices = kb.layoutChoices;
  return kb.keys.filter((k) => k.layoutIndex === -1 || choices[k.layoutIndex] === k.layoutOption);
}

/** Visible matrix positions, without duplicates, in reading order (top to bottom, left to right). */
export function visiblePositions(kb: Keyboard): { row: number; col: number }[] {
  const seen = new Set<string>();
  const out: { row: number; col: number; x: number; y: number }[] = [];
  for (const k of visibleKeys(kb)) {
    const id = `${k.row},${k.col}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ row: k.row, col: k.col, x: k.x, y: k.y });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out.map(({ row, col }) => ({ row, col }));
}

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;

/**
 * Keys a layer sets: on layer 0 every key that is not KC_NO; on higher
 * layers every key that is neither KC_NO nor transparent. Encoders count too.
 */
export function keyCount(kb: Keyboard, layer: number): number {
  const set = (code: number | undefined) =>
    code !== undefined && code !== KC_NO && (layer === 0 || code !== KC_TRNS);
  let n = visiblePositions(kb).filter((p) => set(kb.getKey(layer, p.row, p.col))).length;
  for (const index of kb.encoderIndices) {
    for (const dir of [0, 1] as const) if (set(kb.getEncoder(layer, index, dir))) n++;
  }
  return n;
}

export interface LayerReach {
  /** Layer the key is on. */
  from: number;
  row: number;
  col: number;
  key: LayerKey;
}

/** Keys on any layer that reach `layer`, layer 0 first. */
export function reachesOf(kb: Keyboard, layer: number): LayerReach[] {
  const out: LayerReach[] = [];
  const positions = visiblePositions(kb);
  for (let from = 0; from < kb.layers; from++) {
    for (const p of positions) {
      const code = kb.getKey(from, p.row, p.col);
      if (code === undefined) continue;
      const key = layerKeyOf(kb.keycodes, kb.layers, code);
      if (key && key.layer === layer && from !== layer) out.push({ from, row: p.row, col: p.col, key });
    }
  }
  return out;
}

const VERB: Record<LayerAction, string> = {
  MO: "hold",
  LT: "hold",
  TG: "toggle",
  TO: "switch",
  TT: "tap-toggle",
  OSL: "one-shot",
  DF: "default",
  PDF: "default",
};

/**
 * How a layer is reached, in a few words for the rail: "default" for layer 0,
 * "hold Space" for LT(1, KC_SPACE), "toggle key", "not reached".
 */
export function reachSummary(kb: Keyboard, layer: number): string {
  if (layer === 0) return "default";
  const reaches = reachesOf(kb, layer);
  if (reaches.length === 0) return "not reached";
  const first = reaches[0].key;
  const what =
    first.action === "LT" && first.tap !== undefined
      ? `hold ${kb.keycodes.label(first.tap).text.replace(/\n/g, " ")}`
      : `${VERB[first.action]} key`;
  return reaches.length > 1 ? `${what} +${reaches.length - 1}` : what;
}
