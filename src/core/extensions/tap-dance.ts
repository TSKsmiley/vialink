// SPDX-License-Identifier: GPL-2.0-or-later
// Tap dance, ported from vial-gui's protocol/tap_dance.py (reload, get, set,
// save, restore), protocol/dynamic.py (the entry count) and
// protocol/base_protocol.py (_retrieve_dynamic_entries). Byte layouts are in
// ../protocol/tap-dance.ts.
//
// Deviations from vial-gui:
// - Entries are kept as integers and serialized on save; vial-gui keeps the
//   serialized strings. The saved .vil field is the same.
// - The set reply's status is checked (vial-gui ignores it).
// - .vil restore skips entries it cannot pack (not a 5-element list, or a
//   keycode / tapping term outside 0..65535) instead of raising mid-restore;
//   unparseable keycode strings become KC_NO, as Keycode.deserialize does.
// - On boards without tap dance the extension is inactive and "tap_dance" is
//   left out of saved files, where vial-gui writes an empty list.

import { RESET_KEYCODE } from "../keycodes/table.ts";
import { VIAL_PROTOCOL_DYNAMIC } from "../protocol/constants.ts";
import {
  TAP_DANCE_KEY_FIELDS,
  tapDanceEntriesEqual,
  vialTapDanceGet,
  vialTapDanceSet,
  type TapDanceEntry,
} from "../protocol/tap-dance.ts";
import type { ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

export class TapDanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TapDanceError";
  }
}

/** One entry as vial-gui saves it: four QMK ids and the tapping term. */
export type VilTapDanceEntry = [string, string, string, string, number];

const isU16 = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffff;

export class TapDance {
  private readonly ctx: ExtensionContext;
  private readonly values: TapDanceEntry[];

  constructor(ctx: ExtensionContext, entries: TapDanceEntry[]) {
    this.ctx = ctx;
    this.values = entries;
  }

  get count(): number {
    return this.values.length;
  }

  get entries(): readonly Readonly<TapDanceEntry>[] {
    return this.values;
  }

  get(idx: number): Readonly<TapDanceEntry> {
    const entry = this.values[idx];
    if (!entry) throw new TapDanceError(`tap dance ${idx} does not exist`);
    return entry;
  }

  /**
   * Writes one entry (tap_dance.py tap_dance_set). Does nothing when it is
   * unchanged; asks for an unlock first when it contains QK_BOOT, as vial-gui
   * does (the firmware turns QK_BOOT into KC_NO on a locked board).
   */
  async set(idx: number, entry: TapDanceEntry): Promise<void> {
    const current = this.get(idx);
    for (const field of TAP_DANCE_KEY_FIELDS) {
      if (!isU16(entry[field])) throw new TapDanceError(`invalid keycode for ${field}: ${entry[field]}`);
    }
    if (!isU16(entry.tappingTerm)) {
      throw new TapDanceError(`tapping term must be 0 to 65535 ms, not ${entry.tappingTerm}`);
    }
    if (tapDanceEntriesEqual(current, entry)) return;

    const { keyboard, queue } = this.ctx;
    const boot = keyboard.keycodes.resolve(RESET_KEYCODE);
    if (TAP_DANCE_KEY_FIELDS.some((f) => entry[f] === boot)) {
      await keyboard.ensureUnlocked(`Assigning ${RESET_KEYCODE} (bootloader) in a tap dance`);
    }
    const copy: TapDanceEntry = { ...entry };
    const reply = vialTapDanceSet.decode(await queue.request(vialTapDanceSet.encode(idx, copy)));
    if (!reply.ok) throw new TapDanceError(`the keyboard rejected tap dance ${idx} (status ${reply.status})`);
    this.values[idx] = copy;
    const old: TapDanceEntry = { ...current };
    this.ctx.record({
      label: `Tap dance TD ${idx}`,
      undo: () => this.set(idx, old),
      redo: () => this.set(idx, copy),
      isCurrent: () => tapDanceEntriesEqual(this.get(idx), copy),
    });
    this.ctx.changed();
  }

  /** tap_dance.py save_tap_dance: [on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term]. */
  toVil(): VilTapDanceEntry[] {
    const kc = this.ctx.keyboard.keycodes;
    return this.values.map((e) => [
      kc.serialize(e.onTap),
      kc.serialize(e.onHold),
      kc.serialize(e.onDoubleTap),
      kc.serialize(e.onTapHold),
      e.tappingTerm,
    ]);
  }

  /** Converts one .vil entry; null when vial-gui could not pack it. */
  fromVil(raw: unknown): TapDanceEntry | null {
    if (!Array.isArray(raw) || raw.length < 5) return null;
    const kc = this.ctx.keyboard.keycodes;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const v: unknown = raw[i];
      if (typeof v !== "string" && typeof v !== "number") return null;
      const code = kc.deserialize(v);
      if (!isU16(code)) return null;
      codes.push(code);
    }
    const term: unknown = raw[4];
    if (!isU16(term)) return null;
    return {
      onTap: codes[0],
      onHold: codes[1],
      onDoubleTap: codes[2],
      onTapHold: codes[3],
      tappingTerm: term,
    };
  }

  /** Short human-readable form, e.g. "tap KC_A, hold KC_LCTL, …, 200 ms". */
  describe(entry: TapDanceEntry): string {
    const kc = this.ctx.keyboard.keycodes;
    return (
      `tap ${kc.serialize(entry.onTap)}, hold ${kc.serialize(entry.onHold)}, ` +
      `double tap ${kc.serialize(entry.onDoubleTap)}, tap + hold ${kc.serialize(entry.onTapHold)}, ` +
      `${entry.tappingTerm} ms`
    );
  }
}

/** True when the reply is the request unchanged: no handler answered it (see the header). */
export const tapDanceExtension: KeyboardExtension<TapDance> = {
  id: "tap-dance",
  standard: true,
  name: "Tap dance",
  description: "Keys that do different things when tapped, held, double-tapped or tapped then held (TD(n)).",

  async probe(ctx) {
    const { keyboard, queue } = ctx;
    const count = keyboard.capabilities.dynamic?.tapDance ?? 0;
    if (keyboard.vialProtocol < VIAL_PROTOCOL_DYNAMIC || !count) return null;
    const entries: TapDanceEntry[] = [];
    for (let idx = 0; idx < count; idx++) {
      const reply = vialTapDanceGet.decode(await queue.request(vialTapDanceGet.encode(idx)));
      if (!reply.ok) {
        throw new TapDanceError(`failed retrieving tap dance entry ${idx} from the device`);
      }
      entries.push(reply.entry);
    }
    return new TapDance(ctx, entries);
  },

  vil: {
    keys: ["tap_dance"],
    save: (state) => ({ tap_dance: state.toVil() }),
    restore(state, file) {
      const data = file.tap_dance;
      if (!Array.isArray(data)) return [];
      const steps: ExtensionRestoreStep[] = [];
      for (let idx = 0; idx < Math.min(data.length, state.count); idx++) {
        const entry = state.fromVil(data[idx]);
        if (!entry || tapDanceEntriesEqual(entry, state.get(idx))) continue;
        steps.push({
          description: `Set TD(${idx}): ${state.describe(entry)}`,
          apply: () => state.set(idx, entry),
        });
      }
      return steps;
    },
  },
};
