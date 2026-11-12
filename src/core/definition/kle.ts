// SPDX-License-Identifier: GPL-2.0-only
// KLE (keyboard-layout-editor.com) deserializer, trimmed to the geometry and
// labels a configurator needs. Adapted from Vialite's src/protocol/kleSerial.ts
// (https://github.com/tcyeee/vialite, GPL-2.0), itself ported from vial-gui's
// kle_serial.py, which is based on https://github.com/ijprest/kle-serial.
// Modified for ViaLink, November 2026.

export interface KleKey {
  /** Twelve label slots in KLE's canonical order; labels[0] is top-left. */
  labels: (string | null)[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** Secondary rectangle (ISO Enter, big-ass Enter), relative to (x, y). */
  x2: number;
  y2: number;
  width2: number;
  height2: number;
  rotationX: number;
  rotationY: number;
  /** Degrees, clockwise, around (rotationX, rotationY). */
  rotationAngle: number;
  decal: boolean;
}

type KleRowItem = string | Record<string, unknown>;
export type KleData = (KleRowItem[] | Record<string, unknown>)[];

// prettier-ignore
const LABEL_MAP: number[][] = [
  [ 0, 6, 2, 8, 9,11, 3, 5, 1, 4, 7,10], // 0 = no centering
  [ 1, 7,-1,-1, 9,11, 4,-1,-1,-1,-1,10], // 1 = center x
  [ 3,-1, 5,-1, 9,11,-1,-1, 4,-1,-1,10], // 2 = center y
  [ 4,-1,-1,-1, 9,11,-1,-1,-1,-1,-1,10], // 3 = center x & y
  [ 0, 6, 2, 8,10,-1, 3, 5, 1, 4, 7,-1], // 4 = center front (default)
  [ 1, 7,-1,-1,10,-1, 4,-1,-1,-1,-1,-1], // 5 = center front & x
  [ 3,-1, 5,-1,10,-1,-1,-1, 4,-1,-1,-1], // 6 = center front & y
  [ 4,-1,-1,-1,10,-1,-1,-1,-1,-1,-1,-1], // 7 = center front & x & y
];

function reorderLabels(labels: string[], align: number): (string | null)[] {
  const out: (string | null)[] = new Array(12).fill(null);
  const map = LABEL_MAP[align] ?? LABEL_MAP[4];
  for (let i = 0; i < labels.length && i < 12; i++) {
    const dest = map[i];
    if (labels[i] && dest >= 0) out[dest] = labels[i];
  }
  return out;
}

export class KleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KleError";
  }
}

export function deserializeKle(rows: KleData): KleKey[] {
  const keys: KleKey[] = [];
  const current = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    x2: 0,
    y2: 0,
    width2: 1,
    height2: 1,
    rotationX: 0,
    rotationY: 0,
    rotationAngle: 0,
    decal: false,
  };
  const cluster = { x: 0, y: 0 };
  let align = 4;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) {
      if (r !== 0) throw new KleError("keyboard metadata must be the first element");
      continue;
    }
    for (let k = 0; k < row.length; k++) {
      const item = row[k];
      if (typeof item === "string") {
        keys.push({
          labels: reorderLabels(item.split("\n"), align),
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
          x2: current.x2,
          y2: current.y2,
          width2: current.width2 === 0 ? current.width : current.width2,
          height2: current.height2 === 0 ? current.height : current.height2,
          rotationX: current.rotationX,
          rotationY: current.rotationY,
          rotationAngle: current.rotationAngle,
          decal: current.decal,
        });
        current.x += current.width;
        current.width = current.height = 1;
        current.x2 = current.y2 = current.width2 = current.height2 = 0;
        current.decal = false;
        continue;
      }
      if (typeof item !== "object" || item === null) {
        throw new KleError(`unexpected KLE item ${JSON.stringify(item)}`);
      }
      const p = item as Record<string, unknown>;
      const num = (key: string): number => {
        const v = p[key];
        if (typeof v !== "number") throw new KleError(`KLE property "${key}" must be a number`);
        return v;
      };
      if (k !== 0 && ("r" in p || "rx" in p || "ry" in p)) {
        throw new KleError("rotation can only be specified on the first key in a row");
      }
      if ("r" in p) current.rotationAngle = num("r");
      if ("rx" in p) {
        current.rotationX = cluster.x = num("rx");
        current.x = cluster.x;
        current.y = cluster.y;
      }
      if ("ry" in p) {
        current.rotationY = cluster.y = num("ry");
        current.x = cluster.x;
        current.y = cluster.y;
      }
      if ("a" in p) align = num("a");
      if ("x" in p) current.x += num("x");
      if ("y" in p) current.y += num("y");
      if ("w" in p) current.width = current.width2 = num("w");
      if ("h" in p) current.height = current.height2 = num("h");
      if ("x2" in p) current.x2 = num("x2");
      if ("y2" in p) current.y2 = num("y2");
      if ("w2" in p) current.width2 = num("w2");
      if ("h2" in p) current.height2 = num("h2");
      if ("d" in p) current.decal = Boolean(p.d);
    }
    current.y += 1;
    current.x = current.rotationX;
  }
  return keys;
}
