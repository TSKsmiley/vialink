// SPDX-License-Identifier: GPL-2.0-or-later
// Whole-layer operations (design board 5): copy, paste in three modes, swap,
// clear and duplicate. ViaLink-only; vial-gui has none of these. Plans are
// pure (what would change), so the paste preview can show them before any
// write; applying a plan is one undo history entry.
//
// Keys are addressed by matrix position, over every position in the
// definition (all layout options), so a copy carries keys that the current
// layout option hides.

import { defineHook } from "./extensions/hooks.ts";
import type { Keyboard } from "./keyboard.ts";
import { KC_NO, KC_TRNS, keyCount, layerKeyOf } from "./layerInfo.ts";

/** A copied layer, or some keys of it: codes by "row,col" and encoder "index,direction". */
export interface LayerSnapshot {
  /** The layer it came from, for labels; null when it came from elsewhere (shared text). */
  layer: number | null;
  keys: ReadonlyMap<string, number>;
  encoders: ReadonlyMap<string, number>;
}

export type PasteMode = "replace" | "overlay" | "fill";

export interface KeyWrite {
  kind: "key";
  row: number;
  col: number;
  from: number;
  to: number;
}
export interface EncoderWrite {
  kind: "encoder";
  index: number;
  direction: 0 | 1;
  from: number;
  to: number;
}
export type LayerWrite = KeyWrite | EncoderWrite;

export interface PastePlan {
  target: number;
  writes: LayerWrite[];
  /** Key positions the paste leaves as they are (not counting encoders). */
  unchanged: number;
  /** Positions skipped because the key would reach the layer it is on (MO(2) pasted onto layer 2). */
  selfReferences: { row: number; col: number; code: number }[];
}

const keyId = (row: number, col: number) => `${row},${col}`;
const encId = (index: number, direction: number) => `${index},${direction}`;

/** Every key (all layout options) and, with `encoders`, every encoder direction of a layer. */
export function snapshotLayer(
  kb: Keyboard,
  layer: number,
  only?: readonly (
    { kind: "key"; row: number; col: number } | { kind: "encoder"; index: number; direction: 0 | 1 }
  )[],
): LayerSnapshot {
  const keys = new Map<string, number>();
  const encoders = new Map<string, number>();
  if (only) {
    for (const t of only) {
      if (t.kind === "key") {
        const c = kb.getKey(layer, t.row, t.col);
        if (c !== undefined) keys.set(keyId(t.row, t.col), c);
      } else {
        const c = kb.getEncoder(layer, t.index, t.direction);
        if (c !== undefined) encoders.set(encId(t.index, t.direction), c);
      }
    }
  } else {
    for (const p of kb.matrixPositions) {
      const c = kb.getKey(layer, p.row, p.col);
      if (c !== undefined) keys.set(keyId(p.row, p.col), c);
    }
    for (const index of kb.encoderIndices) {
      for (const direction of [0, 1] as const) {
        const c = kb.getEncoder(layer, index, direction);
        if (c !== undefined) encoders.set(encId(index, direction), c);
      }
    }
  }
  return { layer, keys, encoders };
}

/** Keys set in a snapshot (not KC_NO or transparent), and encoder directions set. */
export function snapshotCounts(s: LayerSnapshot): { keys: number; encoders: number } {
  const set = (c: number) => c !== KC_NO && c !== KC_TRNS;
  return {
    keys: [...s.keys.values()].filter(set).length,
    encoders: [...s.encoders.values()].filter(set).length,
  };
}

const isEmpty = (code: number) => code === KC_NO || code === KC_TRNS;

/**
 * What pasting `source` onto layer `target` writes.
 * - replace: every key the snapshot has, transparent ones included.
 * - overlay: only where the snapshot has a key (transparent leaves the target's key).
 * - fill: only where the target's key is empty (KC_NO or transparent).
 * A key that would reach its own layer (MO(n), LT(n, kc), TG(n)… pasted onto
 * layer n) is left as it is and listed in selfReferences.
 */
export function planPaste(
  kb: Keyboard,
  source: LayerSnapshot,
  target: number,
  mode: PasteMode,
  includeEncoders = true,
): PastePlan {
  const writes: LayerWrite[] = [];
  const selfReferences: PastePlan["selfReferences"] = [];
  let unchanged = 0;
  const wanted = (from: number, to: number): boolean => {
    if (mode === "overlay" && to === KC_TRNS) return false;
    if (mode === "fill" && (to === KC_TRNS || !isEmpty(from))) return false;
    return from !== to;
  };
  const selfRef = (code: number) => layerKeyOf(kb.keycodes, kb.layers, code)?.layer === target;

  for (const [id, to] of source.keys) {
    const [row, col] = id.split(",").map(Number);
    const from = kb.getKey(target, row, col);
    if (from === undefined) continue; // not on this keyboard
    if (wanted(from, to) && selfRef(to)) {
      selfReferences.push({ row, col, code: to });
      unchanged++;
    } else if (wanted(from, to)) writes.push({ kind: "key", row, col, from, to });
    else unchanged++;
  }
  if (includeEncoders) {
    for (const [id, to] of source.encoders) {
      const [index, dir] = id.split(",").map(Number);
      const direction = dir === 0 ? 0 : 1;
      const from = kb.getEncoder(target, index, direction);
      if (from === undefined) continue;
      if (wanted(from, to) && !selfRef(to)) writes.push({ kind: "encoder", index, direction, from, to });
    }
  }
  return { target, writes, unchanged, selfReferences };
}

/** Writes a plan as one undo entry. */
export async function applyLayerWrites(
  kb: Keyboard,
  layer: number,
  writes: readonly LayerWrite[],
  label: string,
): Promise<void> {
  await kb.history.group(label, async () => {
    for (const w of writes) {
      if (w.kind === "key") await kb.setKey(layer, w.row, w.col, w.to);
      else await kb.setEncoder(layer, w.index, w.direction, w.to);
    }
  });
}

/** Writes that make every key and encoder of `layer` transparent (KC_NO on layer 0). */
export function planClear(kb: Keyboard, layer: number): LayerWrite[] {
  const to = layer === 0 ? KC_NO : KC_TRNS;
  const snap = snapshotLayer(kb, layer);
  const writes: LayerWrite[] = [];
  for (const [id, from] of snap.keys) {
    const [row, col] = id.split(",").map(Number);
    if (from !== to) writes.push({ kind: "key", row, col, from, to });
  }
  for (const [id, from] of snap.encoders) {
    const [index, dir] = id.split(",").map(Number);
    if (from !== to) writes.push({ kind: "encoder", index, direction: dir === 0 ? 0 : 1, from, to });
  }
  return writes;
}

/** "Clear layer": every key and encoder of `layer` becomes transparent (empty on layer 0). */
export interface LayerClearEvent {
  readonly layer: number;
}

/** "Swap layers": layers `a` and `b` trade keys and encoders. */
export interface LayerSwapEvent {
  readonly a: number;
  readonly b: number;
}

/** The writes a swap makes, per layer. */
export interface LayerSwapPlan {
  readonly toA: readonly LayerWrite[];
  readonly toB: readonly LayerWrite[];
}

/** Core hook point: after handlers clear their own per-layer data (e.g. layer names removes the name). */
export const layerClear = defineHook<LayerClearEvent, readonly LayerWrite[]>("layer.clear");
/** Core hook point: after handlers move their own per-layer data along (e.g. layer names swaps the names). */
export const layerSwap = defineHook<LayerSwapEvent, LayerSwapPlan>("layer.swap");

/** Writes `writes` onto `layer`, in order (no undo group of its own). */
export async function writeAll(kb: Keyboard, layer: number, writes: readonly LayerWrite[]): Promise<void> {
  for (const w of writes) {
    if (w.kind === "key") await kb.setKey(layer, w.row, w.col, w.to);
    else await kb.setEncoder(layer, w.index, w.direction, w.to);
  }
}

/**
 * Clears a layer as one undo entry, through the {@link layerClear} hook point:
 * extensions may veto or ask first, and their after handlers join the entry.
 */
export async function clearLayer(kb: Keyboard, layer: number, label: string): Promise<void> {
  await kb.runOperation(layerClear, { layer }, planClear(kb, layer), label, (writes) =>
    writeAll(kb, layer, writes),
  );
}

/** Swaps two layers' keys and encoders as one undo entry, through the {@link layerSwap} hook point. */
export async function swapLayers(kb: Keyboard, a: number, b: number, label: string): Promise<void> {
  if (a === b) return;
  const plan: LayerSwapPlan = {
    toA: exactWrites(kb, snapshotLayer(kb, b), a),
    toB: exactWrites(kb, snapshotLayer(kb, a), b),
  };
  await kb.runOperation(layerSwap, { a, b }, plan, label, async ({ toA, toB }) => {
    await writeAll(kb, a, toA);
    await writeAll(kb, b, toB);
  });
}

/** Like a replace paste but without the self-reference rule: the layer becomes exactly `src`. */
function exactWrites(kb: Keyboard, src: LayerSnapshot, layer: number): LayerWrite[] {
  const writes: LayerWrite[] = [];
  for (const [id, to] of src.keys) {
    const [row, col] = id.split(",").map(Number);
    const from = kb.getKey(layer, row, col);
    if (from !== undefined && from !== to) writes.push({ kind: "key", row, col, from, to });
  }
  for (const [id, to] of src.encoders) {
    const [index, dir] = id.split(",").map(Number);
    const direction = dir === 0 ? 0 : 1;
    const from = kb.getEncoder(layer, index, direction);
    if (from !== undefined && from !== to) writes.push({ kind: "encoder", index, direction, from, to });
  }
  return writes;
}

/** The first layer above 0 with no keys set and no name, or null. */
export function firstEmptyLayer(
  kb: Keyboard,
  named: (layer: number) => boolean = () => false,
): number | null {
  for (let l = 1; l < kb.layers; l++) if (keyCount(kb, l) === 0 && !named(l)) return l;
  return null;
}
