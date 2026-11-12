// SPDX-License-Identifier: GPL-2.0-only
// Pure layout placement, mirroring vial-gui's widgets/keyboard_widget.py
// place_widgets(): keys of an unselected layout option are hidden, each
// selected option variant is shifted onto variant 0's top-left, and the result
// is normalized to start at (0, 0). Adapted from Vialite's
// src/components/keymap/layout/layoutGeometry.ts (https://github.com/tcyeee/vialite, GPL-2.0).
// Modified for ViaLink, November 2026.

import type { PhysicalEncoder, PhysicalKey, PhysicalShape } from "./definition.ts";

export interface Placed<T> {
  shape: T;
  /** Offset to add to the shape's (rotated) coordinates, in key units. */
  shiftX: number;
  shiftY: number;
}

export interface PlacedLayout {
  keys: Placed<PhysicalKey>[];
  encoders: Placed<PhysicalEncoder>[];
  width: number;
  height: number;
}

type Pt = [number, number];

export function rotatePoint(px: number, py: number, angleDeg: number, rx: number, ry: number): Pt {
  if (!angleDeg) return [px, py];
  const t = (angleDeg * Math.PI) / 180;
  const dx = px - rx;
  const dy = py - ry;
  return [rx + dx * Math.cos(t) - dy * Math.sin(t), ry + dx * Math.sin(t) + dy * Math.cos(t)];
}

export function hasSecondRect(key: PhysicalKey): boolean {
  return key.x2 !== 0 || key.y2 !== 0 || key.width2 !== key.width || key.height2 !== key.height;
}

function corners(s: PhysicalShape): Pt[] {
  const rect = (x: number, y: number, w: number, h: number): Pt[] =>
    (
      [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ] as Pt[]
    ).map(([px, py]) => rotatePoint(px, py, s.rotationAngle, s.rotationX, s.rotationY));
  const pts = rect(s.x, s.y, s.width, s.height);
  if ("x2" in s && hasSecondRect(s as PhysicalKey)) {
    const k = s as PhysicalKey;
    pts.push(...rect(k.x + k.x2, k.y + k.y2, k.width2, k.height2));
  }
  return pts;
}

/** `choices[i]` is the selected option of layout label i (see unpackLayoutOptions). */
export function placeLayout(
  keys: PhysicalKey[],
  encoders: PhysicalEncoder[],
  choices: number[],
): PlacedLayout {
  const all: PhysicalShape[] = [...keys, ...encoders];
  const groupMin = new Map<string, Pt>();
  for (const s of all) {
    if (s.layoutIndex === -1) continue;
    const group = `${s.layoutIndex},${s.layoutOption}`;
    const cur = groupMin.get(group) ?? [Infinity, Infinity];
    for (const [px, py] of corners(s)) {
      cur[0] = Math.min(cur[0], px);
      cur[1] = Math.min(cur[1], py);
    }
    groupMin.set(group, cur);
  }

  const visible = (s: PhysicalShape): boolean =>
    s.layoutIndex === -1 || (choices[s.layoutIndex] ?? 0) === s.layoutOption;

  const optionShift = (s: PhysicalShape): Pt => {
    if (s.layoutIndex === -1) return [0, 0];
    const cur = groupMin.get(`${s.layoutIndex},${s.layoutOption}`) ?? [0, 0];
    const base = groupMin.get(`${s.layoutIndex},0`) ?? cur;
    return [base[0] - cur[0], base[1] - cur[1]];
  };

  const visKeys = keys.filter(visible);
  const visEncoders = encoders.filter(visible);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of [...visKeys, ...visEncoders]) {
    const [sx, sy] = optionShift(s);
    for (const [px, py] of corners(s)) {
      minX = Math.min(minX, px + sx);
      minY = Math.min(minY, py + sy);
      maxX = Math.max(maxX, px + sx);
      maxY = Math.max(maxY, py + sy);
    }
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;

  const place = <T extends PhysicalShape>(shape: T): Placed<T> => {
    const [sx, sy] = optionShift(shape);
    return { shape, shiftX: sx - minX, shiftY: sy - minY };
  };

  return {
    keys: visKeys.map(place),
    encoders: visEncoders.map(place),
    width: maxX - minX,
    height: maxY - minY,
  };
}
