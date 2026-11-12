// SPDX-License-Identifier: GPL-2.0-only
// Packing of the layout-options u32, as vial-gui's editor/layout_editor.py
// does it: each label takes 1 bit (a bare string is a checkbox) or
// bit_length(choices - 1) bits (a [title, ...choices] dropdown), the first label
// in the most significant position. Adapted from Vialite's keyboard.ts
// (https://github.com/tcyeee/vialite, GPL-2.0). Modified for ViaLink, November 2026.

/** A bare string is a boolean toggle; an array is [title, ...choices]. */
export type LayoutLabel = string | string[];

export function layoutOptionBits(label: LayoutLabel): number {
  if (typeof label === "string") return 1;
  const choices = label.length - 1;
  return choices <= 1 ? 0 : 32 - Math.clz32(choices - 1);
}

/** Splits the packed value into one choice per label. */
export function unpackLayoutOptions(value: number, labels: LayoutLabel[]): number[] {
  const choices = new Array<number>(labels.length).fill(0);
  let rest = value >>> 0;
  for (let i = labels.length - 1; i >= 0; i--) {
    const bits = layoutOptionBits(labels[i]);
    choices[i] = bits === 0 ? 0 : rest & ((1 << bits) - 1);
    rest = bits === 32 ? 0 : rest >>> bits;
  }
  return choices;
}

export function packLayoutOptions(choices: number[], labels: LayoutLabel[]): number {
  let value = 0;
  for (let i = 0; i < labels.length; i++) {
    const bits = layoutOptionBits(labels[i]);
    if (bits === 0) continue;
    value = ((value << bits) | ((choices[i] ?? 0) & ((1 << bits) - 1))) >>> 0;
  }
  return value;
}

/** Title and choice names for one label, for the options panel. */
export function describeLayoutLabel(label: LayoutLabel): { title: string; choices: string[] | null } {
  if (typeof label === "string") return { title: label, choices: null };
  return { title: label[0] ?? "", choices: label.slice(1) };
}
