// SPDX-License-Identifier: GPL-2.0-or-later
// Key overrides, ported from vial-gui src/main/python/protocol/key_override.py
// (ProtocolKeyOverride.reload/set/save/restore, KeyOverrideEntry.save/restore)
// with the gating of editor/key_override.py and protocol/dynamic.py. Firmware:
// vial-qmk quantum/vial.c (dynamic_vial_key_override_get/set).
//
// Deviations from vial-gui:
// - Gated on Vial protocol >= 5 (VIAL_PROTOCOL_KEY_OVERRIDE, as vial-gui's
//   about box states) as well as a non-zero count; vial-gui's editor checks >= 4.
// - When the very first entry cannot be read the feature is treated as
//   unsupported (null) instead of failing the whole load; later read failures
//   throw, as vial-gui's _retrieve_dynamic_entries does.
// - The set reply's status byte is checked (vial-gui ignores it); the local
//   state only changes after the board accepted the write.
// - .vil entries that miss a field or hold an out-of-range value are skipped
//   (vial-gui raises and aborts the rest of the restore).

import { RESET_KEYCODE } from "../keycodes/table.ts";
import {
  KO_ENABLED,
  KO_OPTIONS_MASK,
  vialKeyOverrideGet,
  vialKeyOverrideSet,
  type KeyOverrideEntry,
} from "../protocol/key-overrides.ts";
import { VIAL_PROTOCOL_KEY_OVERRIDE } from "../protocol/constants.ts";
import type { ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

export type { KeyOverrideEntry } from "../protocol/key-overrides.ts";

export class KeyOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyOverrideError";
  }
}

/** A .vil "key_override" entry, keys and order as KeyOverrideEntry.save(). */
export interface KeyOverrideVilEntry {
  trigger: string;
  replacement: string;
  layers: number;
  trigger_mods: number;
  negative_mod_mask: number;
  suppressed_mods: number;
  options: number;
}

/** KeyOverrideOptions(data).serialize(): bit 6 does not survive a round trip. */
function normalize(e: KeyOverrideEntry): KeyOverrideEntry {
  return { ...e, options: e.options & KO_OPTIONS_MASK };
}

export function sameKeyOverride(a: KeyOverrideEntry, b: KeyOverrideEntry): boolean {
  return (
    a.trigger === b.trigger &&
    a.replacement === b.replacement &&
    a.layers === b.layers &&
    a.triggerMods === b.triggerMods &&
    a.negativeModMask === b.negativeModMask &&
    a.suppressedMods === b.suppressedMods &&
    (a.options & KO_OPTIONS_MASK) === (b.options & KO_OPTIONS_MASK)
  );
}

const isUint = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

function checkEntry(e: KeyOverrideEntry): void {
  const fields: [string, number, number][] = [
    ["trigger", e.trigger, 0xffff],
    ["replacement", e.replacement, 0xffff],
    ["layers", e.layers, 0xffff],
    ["trigger mods", e.triggerMods, 0xff],
    ["negative mods", e.negativeModMask, 0xff],
    ["suppressed mods", e.suppressedMods, 0xff],
    ["options", e.options, 0xff],
  ];
  for (const [name, value, max] of fields) {
    if (!isUint(value, max)) throw new KeyOverrideError(`${name} must be an integer from 0 to ${max}`);
  }
}

export class KeyOverrides {
  private readonly ctx: ExtensionContext;
  private readonly values: KeyOverrideEntry[];
  /** Writes run one after another, so an update always starts from the latest entry. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(ctx: ExtensionContext, entries: KeyOverrideEntry[]) {
    this.ctx = ctx;
    this.values = entries.map(normalize);
  }

  get count(): number {
    return this.values.length;
  }

  get entries(): readonly Readonly<KeyOverrideEntry>[] {
    return this.values;
  }

  get(index: number): Readonly<KeyOverrideEntry> {
    const e = this.values[index];
    if (!e) throw new KeyOverrideError(`key override ${index} does not exist`);
    return e;
  }

  /**
   * key_override_set: writes the entry when it differs from the board's.
   * Unlocks first when the replacement is QK_BOOT, as vial-gui does.
   */
  set(index: number, entry: KeyOverrideEntry): Promise<void> {
    return this.enqueue(() => this.write(index, entry));
  }

  /** Changes some fields of an entry, computed from its state once earlier writes finished. */
  update(
    index: number,
    change: Partial<KeyOverrideEntry> | ((e: Readonly<KeyOverrideEntry>) => Partial<KeyOverrideEntry>),
  ): Promise<void> {
    return this.enqueue(() => {
      const current = this.get(index);
      const patch = typeof change === "function" ? change(current) : change;
      return this.write(index, { ...current, ...patch });
    });
  }

  /** KeyOverrideEntry.save() for every entry: keycodes as QMK ids. */
  toVil(): KeyOverrideVilEntry[] {
    const kc = this.ctx.keyboard.keycodes;
    return this.values.map((e) => ({
      trigger: kc.serialize(e.trigger),
      replacement: kc.serialize(e.replacement),
      layers: e.layers,
      trigger_mods: e.triggerMods,
      negative_mod_mask: e.negativeModMask,
      suppressed_mods: e.suppressedMods,
      options: e.options & KO_OPTIONS_MASK,
    }));
  }

  /**
   * KeyOverrideEntry.restore() of one .vil entry: keycodes go through
   * Keycode.deserialize (unparsable → KC_NO). Null when the entry is malformed.
   */
  parseVil(data: unknown): KeyOverrideEntry | null {
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    const kc = this.ctx.keyboard.keycodes;
    const keycode = (v: unknown): number | null => {
      if (typeof v === "string") return kc.deserialize(v);
      return isUint(v, 0xffff) ? v : null;
    };
    const trigger = keycode(d.trigger);
    const replacement = keycode(d.replacement);
    const { layers, trigger_mods, negative_mod_mask, suppressed_mods, options } = d;
    if (trigger === null || replacement === null || !isUint(layers, 0xffff)) return null;
    if (!isUint(trigger_mods, 0xff) || !isUint(negative_mod_mask, 0xff)) return null;
    if (!isUint(suppressed_mods, 0xff) || !isUint(options, 0xff)) return null;
    return {
      trigger,
      replacement,
      layers,
      triggerMods: trigger_mods,
      negativeModMask: negative_mod_mask,
      suppressedMods: suppressed_mods,
      options: options & KO_OPTIONS_MASK,
    };
  }

  /** Short summary for restore confirmations, e.g. "KC_A → KC_B, enabled". */
  describe(e: KeyOverrideEntry): string {
    const kc = this.ctx.keyboard.keycodes;
    const state = e.options & KO_ENABLED ? "enabled" : "disabled";
    return `${kc.serialize(e.trigger)} → ${kc.serialize(e.replacement)}, ${state}`;
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async write(index: number, wanted: KeyOverrideEntry): Promise<void> {
    const { keyboard, queue } = this.ctx;
    const current = this.get(index);
    checkEntry(wanted);
    const entry = normalize(wanted);
    if (sameKeyOverride(entry, current)) return;
    if (entry.replacement === keyboard.keycodes.resolve(RESET_KEYCODE)) {
      await keyboard.ensureUnlocked("Assigning QK_BOOT (bootloader) to a key override");
    }
    const reply = vialKeyOverrideSet.decode(await queue.request(vialKeyOverrideSet.encode(index, entry)));
    if (!reply.ok) {
      throw new KeyOverrideError(`the keyboard rejected key override ${index + 1} (status ${reply.status})`);
    }
    this.values[index] = entry;
    const old = { ...current };
    this.ctx.record({
      label: `Key override ${index + 1}: ${this.describe(entry)}`,
      undo: () => this.set(index, old),
      redo: () => this.set(index, entry),
      isCurrent: () => sameKeyOverride(this.get(index), entry),
    });
    this.ctx.changed();
  }
}

export const keyOverridesExtension: KeyboardExtension<KeyOverrides> = {
  id: "key-overrides",
  standard: true,
  name: "Key overrides",
  description: "Replace a key while certain modifiers are held (QMK key overrides). Needs Vial protocol 5.",

  async probe(ctx) {
    const { keyboard, queue } = ctx;
    if (keyboard.vialProtocol < VIAL_PROTOCOL_KEY_OVERRIDE) return null;
    const count = keyboard.capabilities.dynamic?.keyOverride ?? 0;
    if (count === 0) return null;
    const entries: KeyOverrideEntry[] = [];
    for (let i = 0; i < count; i++) {
      const reply = vialKeyOverrideGet.decode(await queue.request(vialKeyOverrideGet.encode(i)));
      if (!reply.ok) {
        if (i === 0) return null;
        throw new KeyOverrideError(
          `failed retrieving key override ${i} from the device (status ${reply.status})`,
        );
      }
      entries.push(reply.entry);
    }
    return new KeyOverrides(ctx, entries);
  },

  vil: {
    keys: ["key_override"],
    save: (state) => ({ key_override: state.toVil() }),
    restore(state, file) {
      const data = file.key_override;
      if (!Array.isArray(data)) return [];
      const steps: ExtensionRestoreStep[] = [];
      data.forEach((raw, x) => {
        if (x >= state.count) return;
        const entry = state.parseVil(raw);
        if (!entry || sameKeyOverride(entry, state.get(x))) return;
        steps.push({
          description: `Set key override ${x + 1} (${state.describe(entry)})`,
          apply: () => state.set(x, entry),
        });
      });
      return steps;
    },
  },
};
