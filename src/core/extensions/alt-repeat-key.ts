// SPDX-License-Identifier: GPL-2.0-or-later
// Alt repeat keys, ported from vial-gui src/main/python/protocol/alt_repeat_key.py
// (ProtocolAltRepeatKey: reload/get/set/save/restore) and protocol/dynamic.py
// (the entry count), with vial-qmk quantum/vial.c as the firmware reference.
//
// - Active when the board reports alt repeat key entries (Vial protocol ≥ 4 and
//   a non-zero count in the dynamic entry counts), as editor/alt_repeat_key.py's
//   valid() decides whether the tab shows.
// - Writes are skipped when the entry is unchanged; like vial-gui, the board is
//   unlocked first only when the entry assigns QK_BOOT (vial.c's keycode
//   firewall would otherwise turn it into KC_NO).
// - .vil: an "alt_repeat_key" list, one {"keycode", "alt_keycode",
//   "allowed_mods", "options"} dict per entry, keycodes as QMK id strings.
//
// - Keycodes restored from a .vil file are written back as the file spelled
//   them (an alias, a number or an unknown name), as AltRepeatKeyEntry keeps
//   data["keycode"] verbatim; any later edit returns to serialize() strings.
//
// Deviations from vial-gui: a non-zero status in the set reply is reported as
// an error (vial-gui ignores the reply); malformed .vil entries (missing
// fields, allowed_mods outside 0-255) are skipped instead of aborting the load.

import { RESET_KEYCODE } from "../keycodes/table.ts";
import {
  altRepeatKeyEntriesEqual,
  AREP_ENABLED,
  AREP_OPTIONS_MASK,
  normalizeAltRepeatKeyEntry,
  vialAltRepeatKeyGet,
  vialAltRepeatKeySet,
  type AltRepeatKeyEntry,
} from "../protocol/alt-repeat-key.ts";
import { VIAL_PROTOCOL_DYNAMIC } from "../protocol/constants.ts";
import type { ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

export class AltRepeatKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AltRepeatKeyError";
  }
}

/**
 * One entry as vial-gui's AltRepeatKeyEntry.save() writes it to a .vil file.
 * Keycodes are serialize() strings, or a restored file's own values.
 */
export interface AltRepeatKeyVilEntry {
  keycode: string | number;
  alt_keycode: string | number;
  allowed_mods: number;
  options: number;
}

/** The keycodes of a restored .vil entry exactly as the file wrote them. */
export interface AltRepeatKeyVilKeycodes {
  keycode: string | number;
  alt_keycode: string | number;
}

/** A parsed .vil entry: the decoded entry plus its keycodes as the file wrote them. */
export interface AltRepeatKeyVilParse {
  entry: AltRepeatKeyEntry;
  raw: AltRepeatKeyVilKeycodes;
}

export class AltRepeatKeys {
  private readonly ctx: ExtensionContext;
  private readonly values: AltRepeatKeyEntry[];
  /** Per entry, the .vil spelling of its keycodes when it was last set by a restore. */
  private readonly vilKeycodes: (AltRepeatKeyVilKeycodes | undefined)[] = [];

  constructor(ctx: ExtensionContext, entries: AltRepeatKeyEntry[]) {
    this.ctx = ctx;
    this.values = entries.map(normalizeAltRepeatKeyEntry);
  }

  get count(): number {
    return this.values.length;
  }

  get entries(): readonly Readonly<AltRepeatKeyEntry>[] {
    return this.values;
  }

  get(idx: number): Readonly<AltRepeatKeyEntry> {
    const entry = this.values[idx];
    if (!entry) throw new AltRepeatKeyError(`alt repeat key ${idx} does not exist`);
    return entry;
  }

  /**
   * alt_repeat_key_set: writes the entry when it differs from the board's.
   * `vilKeycodes` (from a .vil restore) is what save() writes back for the
   * keycodes, as vial-gui stores the restored entry object itself.
   */
  async set(idx: number, entry: AltRepeatKeyEntry, vilKeycodes?: AltRepeatKeyVilKeycodes): Promise<void> {
    const current = this.get(idx);
    for (const [name, value, max] of [
      ["keycode", entry.keycode, 0xffff],
      ["alt keycode", entry.altKeycode, 0xffff],
      ["allowed mods", entry.allowedMods, 0xff],
      ["options", entry.options, 0xff],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new AltRepeatKeyError(`invalid ${name} ${value} for alt repeat key ${idx + 1}`);
      }
    }
    const wanted = normalizeAltRepeatKeyEntry(entry);
    if (altRepeatKeyEntriesEqual(wanted, current)) return;

    const { keyboard, queue } = this.ctx;
    const boot = keyboard.keycodes.resolve(RESET_KEYCODE);
    if (wanted.keycode === boot || wanted.altKeycode === boot) {
      await keyboard.ensureUnlocked("Assigning QK_BOOT (bootloader) to an alt repeat key");
    }
    const reply = vialAltRepeatKeySet.decode(await queue.request(vialAltRepeatKeySet.encode(idx, wanted)));
    if (!reply.ok) {
      throw new AltRepeatKeyError(`the keyboard rejected alt repeat key ${idx + 1} (status ${reply.status})`);
    }
    const oldVil = this.vilKeycodes[idx];
    this.values[idx] = wanted;
    this.vilKeycodes[idx] = vilKeycodes ? { ...vilKeycodes } : undefined;
    const old = { ...current };
    this.ctx.record({
      label: `Alt repeat key ${idx + 1}: ${keyboard.codeName(wanted.keycode)} → ${keyboard.codeName(wanted.altKeycode)}`,
      undo: () => this.set(idx, old, oldVil),
      redo: () => this.set(idx, wanted, vilKeycodes),
      isCurrent: () => altRepeatKeyEntriesEqual(this.get(idx), wanted),
    });
    this.ctx.changed();
  }

  /** save_alt_repeat_key(): AltRepeatKeyEntry.save() per entry. */
  save(): AltRepeatKeyVilEntry[] {
    const kc = this.ctx.keyboard.keycodes;
    return this.values.map((e, idx) => ({
      keycode: this.vilKeycodes[idx]?.keycode ?? kc.serialize(e.keycode),
      alt_keycode: this.vilKeycodes[idx]?.alt_keycode ?? kc.serialize(e.altKeycode),
      allowed_mods: e.allowedMods,
      options: e.options,
    }));
  }

  /**
   * AltRepeatKeyEntry.restore() for one .vil dict, or null when it is
   * malformed. Keycodes go through Keycode.deserialize, which (as in vial-gui)
   * turns anything it cannot parse into KC_NO.
   */
  parseVilEntry(data: unknown): AltRepeatKeyVilParse | null {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const d = data as Record<string, unknown>;
    const isKeycode = (v: unknown) => typeof v === "string" || (Number.isInteger(v) && (v as number) >= 0);
    if (!isKeycode(d.keycode) || !isKeycode(d.alt_keycode)) return null;
    const mods = d.allowed_mods;
    const options = d.options;
    if (!Number.isInteger(mods) || (mods as number) < 0 || (mods as number) > 0xff) return null;
    if (!Number.isInteger(options)) return null;
    const kc = this.ctx.keyboard.keycodes;
    const keycode = kc.deserialize(d.keycode as string | number);
    const altKeycode = kc.deserialize(d.alt_keycode as string | number);
    if (keycode > 0xffff || altKeycode > 0xffff) return null;
    return {
      entry: {
        keycode,
        altKeycode,
        allowedMods: mods as number,
        // AltRepeatKeyOptions(data["options"]) keeps bits 0-3 only.
        options: (options as number) & AREP_OPTIONS_MASK,
      },
      raw: { keycode: d.keycode as string | number, alt_keycode: d.alt_keycode as string | number },
    };
  }

  describe(idx: number, entry: AltRepeatKeyEntry): string {
    const kc = this.ctx.keyboard.keycodes;
    const state = entry.options & AREP_ENABLED ? "enabled" : "disabled";
    return `Set alt repeat key ${idx + 1}: ${kc.serialize(entry.keycode)} → ${kc.serialize(entry.altKeycode)} (${state})`;
  }
}

export const altRepeatKeyExtension: KeyboardExtension<AltRepeatKeys> = {
  id: "alt-repeat-key",
  standard: true,
  name: "Alt repeat keys",
  description:
    "Pairs of keys for QMK's Alt Repeat Key: after the last key, the alt repeat key sends its alternate.",

  async probe(ctx) {
    const { keyboard, queue } = ctx;
    const count = keyboard.capabilities.dynamic?.altRepeatKey ?? 0;
    if (keyboard.vialProtocol < VIAL_PROTOCOL_DYNAMIC || count === 0) return null;
    // reload_alt_repeat_key → _retrieve_dynamic_entries: every entry, retries=20,
    // and a non-zero status aborts the load.
    const entries: AltRepeatKeyEntry[] = [];
    for (let idx = 0; idx < count; idx++) {
      const reply = vialAltRepeatKeyGet.decode(
        await queue.request(vialAltRepeatKeyGet.encode(idx), { retries: 20 }),
      );
      if (!reply.ok) {
        throw new AltRepeatKeyError(`failed retrieving alt repeat key entry ${idx} from the device`);
      }
      entries.push(reply.entry);
    }
    return new AltRepeatKeys(ctx, entries);
  },

  vil: {
    keys: ["alt_repeat_key"],
    save: (state) => ({ alt_repeat_key: state.save() }),
    restore(state, file) {
      // restore_layout: data.get("alt_repeat_key", []), entries beyond the count ignored.
      const data = file.alt_repeat_key;
      if (!Array.isArray(data)) return [];
      const steps: ExtensionRestoreStep[] = [];
      for (let idx = 0; idx < Math.min(data.length, state.count); idx++) {
        const parsed = state.parseVilEntry(data[idx]);
        if (parsed === null || altRepeatKeyEntriesEqual(parsed.entry, state.get(idx))) continue;
        const { entry, raw } = parsed;
        steps.push({ description: state.describe(idx, entry), apply: () => state.set(idx, entry, raw) });
      }
      return steps;
    },
  },
};
