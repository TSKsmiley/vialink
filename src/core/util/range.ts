// SPDX-License-Identifier: GPL-2.0-or-later

/** The integers from `from` up to, but not including, `to`. */
export function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
