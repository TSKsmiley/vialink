// SPDX-License-Identifier: GPL-2.0-or-later
// Copying keys and pasting them onto other keys, on any layer. ViaLink
// addition: vial-gui has no key clipboard. Also where keys sit as drawn, for
// selecting a block (Shift+click) or everything under a dragged box.
//
// A copy is a list of keycodes, each with the key it came from when it was
// copied in ViaLink. Text from the clipboard ("KC_A LT(1,KC_SPC)") gives
// keycodes without places. Where they land:
// - one keycode: on every selected key;
// - as many keycodes as selected keys: paired in reading order;
// - several onto one selected key: in the shape they were copied in, the
//   first (in reading order) on the selected key; keys that land on no key
//   are left out. Text has no shape: it continues in reading order instead.

import { placeLayout, shapeBox, type ShapeBox } from "./definition/geometry.ts";
import type { Keyboard } from "./keyboard.ts";
import { visiblePositions } from "./layerInfo.ts";
import type { KeycodeTable } from "./keycodes/table.ts";

export type KeyTarget =
  { kind: "key"; row: number; col: number } | { kind: "encoder"; index: number; direction: 0 | 1 };

export interface CopiedKey {
  code: number;
  /** The key it was copied from; none for keycodes pasted as text. */
  from?: KeyTarget;
}

export interface KeyWrite {
  target: KeyTarget;
  code: number;
}

export type KeyPastePlan = { writes: KeyWrite[]; missed: number } | { error: string };

/** Most keycodes one paste takes from text; more is not a list of keys. */
const MAX_TEXT_KEYS = 512;

const idOf = (t: KeyTarget) => (t.kind === "key" ? `k${t.row},${t.col}` : `e${t.index},${t.direction}`);

/** Every visible key and encoder direction with where it is drawn, in key units. */
export function keyBoxes(kb: Keyboard): { target: KeyTarget; box: ShapeBox }[] {
  const placed = placeLayout(kb.keys, kb.encoders, kb.layoutChoices);
  const seen = new Set<string>();
  const out: { target: KeyTarget; box: ShapeBox }[] = [];
  for (const p of placed.keys) {
    const target: KeyTarget = { kind: "key", row: p.shape.row, col: p.shape.col };
    if (seen.has(idOf(target))) continue;
    seen.add(idOf(target));
    out.push({ target, box: shapeBox(p) });
  }
  for (const p of placed.encoders) {
    out.push({
      target: { kind: "encoder", index: p.shape.index, direction: p.shape.direction },
      box: shapeBox(p),
    });
  }
  return out;
}

/** Keys and encoders whose drawn shape overlaps the box (key units), as a dragged selection box picks them. */
export function targetsInBox(
  boxes: readonly { target: KeyTarget; box: ShapeBox }[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): KeyTarget[] {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
  return boxes
    .filter(({ box }) => box.minX < r && box.maxX > l && box.minY < b && box.maxY > t)
    .map((e) => e.target);
}

/**
 * The keys of a block, as Shift+click selects it: every key whose centre lies
 * in the rectangle between the two keys' centres. A little slack takes in
 * staggered columns.
 */
export function keysBetween(kb: Keyboard, a: KeyTarget, b: KeyTarget): KeyTarget[] {
  const boxes = keyBoxes(kb).filter((e) => e.target.kind === "key");
  const at = (t: KeyTarget) => boxes.find((e) => idOf(e.target) === idOf(t))?.box;
  const [ba, bb] = [at(a), at(b)];
  if (!ba || !bb) return [b];
  const slack = 0.3;
  const [l, r] = [Math.min(ba.cx, bb.cx) - slack, Math.max(ba.cx, bb.cx) + slack];
  const [t, d] = [Math.min(ba.cy, bb.cy) - slack, Math.max(ba.cy, bb.cy) + slack];
  return boxes
    .filter(({ box }) => box.cx >= l && box.cx <= r && box.cy >= t && box.cy <= d)
    .map((e) => e.target);
}

/** Sorts targets top to bottom, left to right, by where they are drawn. */
function readingOrder<T>(items: readonly T[], target: (item: T) => KeyTarget | undefined, kb: Keyboard): T[] {
  const centre = new Map(keyBoxes(kb).map((e) => [idOf(e.target), e.box]));
  const pos = (item: T) => {
    const t = target(item);
    const box = t ? centre.get(idOf(t)) : undefined;
    return box ? [box.cy, box.cx] : [Infinity, Infinity];
  };
  return [...items].sort((p, q) => {
    const [py, px] = pos(p);
    const [qy, qx] = pos(q);
    return py - qy || px - qx;
  });
}

/** Targets top to bottom, left to right, as drawn (the order copied keys go out as text). */
export function inReadingOrder(kb: Keyboard, targets: readonly KeyTarget[]): KeyTarget[] {
  return readingOrder(targets, (t) => t, kb);
}

export function planKeyPaste(
  kb: Keyboard,
  copied: readonly CopiedKey[],
  targets: readonly KeyTarget[],
): KeyPastePlan {
  if (copied.length === 0) return { error: "Nothing is copied: select keys and press Ctrl+C first." };
  if (targets.length === 0) return { error: "Select the keys to paste onto first." };

  if (copied.length === 1)
    return { writes: targets.map((target) => ({ target, code: copied[0].code })), missed: 0 };

  const placed = copied.every((c) => c.from !== undefined);
  const source = placed ? readingOrder(copied, (c) => c.from, kb) : [...copied];

  if (copied.length === targets.length) {
    const onto = readingOrder(targets, (t) => t, kb);
    return { writes: onto.map((target, i) => ({ target, code: source[i].code })), missed: 0 };
  }

  if (targets.length === 1 && targets[0].kind === "key") {
    const start = targets[0];
    const writes: KeyWrite[] = [];
    const taken = new Set<string>();
    const add = (target: KeyTarget | undefined, code: number) => {
      if (!target || taken.has(idOf(target))) return false;
      taken.add(idOf(target));
      writes.push({ target, code });
      return true;
    };
    if (placed) {
      // The copied shape, moved so its first key sits on the selected key.
      const boxes = keyBoxes(kb);
      const boxOf = (t: KeyTarget) => boxes.find((e) => idOf(e.target) === idOf(t))?.box;
      const anchor = boxOf(source[0].from!);
      const dest = boxOf(start);
      const keys = boxes.filter((e) => e.target.kind === "key");
      let missed = 0;
      for (const c of source) {
        const from = c.from!.kind === "key" ? boxOf(c.from!) : undefined;
        if (!from || !anchor || !dest) {
          missed++;
          continue;
        }
        const x = dest.cx + from.cx - anchor.cx;
        const y = dest.cy + from.cy - anchor.cy;
        let best: KeyTarget | undefined;
        let bestDist = 0.5;
        for (const k of keys) {
          const d = Math.hypot(k.box.cx - x, k.box.cy - y);
          if (d < bestDist) {
            best = k.target;
            bestDist = d;
          }
        }
        if (!add(best, c.code)) missed++;
      }
      return { writes, missed };
    }
    // Text: on from the selected key in reading order.
    const order = visiblePositions(kb);
    const i = order.findIndex((p) => p.row === start.row && p.col === start.col);
    let missed = 0;
    source.forEach((c, n) => {
      const p = i < 0 ? undefined : order[i + n];
      if (!add(p && { kind: "key", row: p.row, col: p.col }, c.code)) missed++;
    });
    return { writes, missed };
  }

  const n = copied.length;
  return {
    error: `${n} keys are copied: select one key to paste them from there, or ${n} keys to paste them onto.`,
  };
}

/** Copied keycodes as text for the system clipboard: QMK names, space-separated. */
export function keysText(table: KeycodeTable, codes: readonly number[]): string {
  return codes.map((c) => table.serialize(c)).join(" ");
}

/**
 * Keycodes from clipboard text such as "KC_A LT(1, KC_SPC)": names split at
 * spaces outside brackets. Null unless every part is a keycode.
 */
export function parseKeysText(table: KeycodeTable, text: string): number[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  if (parts.length === 0 || parts.length > MAX_TEXT_KEYS || depth !== 0) return null;
  // Bare numbers are text, not keys (the parser would read "12" as keycode 12).
  if (parts.some((p) => /^\d+$/.test(p))) return null;
  try {
    return parts.map((p) => table.parse(p));
  } catch {
    return null;
  }
}
