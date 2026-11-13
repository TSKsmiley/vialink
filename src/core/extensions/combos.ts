// SPDX-License-Identifier: GPL-2.0-or-later
// Combos, ported from vial-gui's protocol/combo.py (reload_combo, combo_set,
// save_combo, restore_combo), protocol/base_protocol.py
// (_retrieve_dynamic_entries) and protocol/dynamic.py (combo_count), with the
// firmware side in vial-qmk's quantum/vial.c. Byte layouts are in
// ../protocol/combos.ts.
//
// - Active when the board speaks Vial protocol 4+ and reports a combo count > 0
//   (editor/combos.py valid()).
// - Writes are skipped when the entry is unchanged; vial-gui unlocks first only
//   when the output key is QK_BOOT (RESET_KEYCODE), which is also the only
//   field vial.c's keycode firewall checks.
// - .vil "combo": a list of [key1, key2, key3, key4, output] QMK id strings
//   (Keycode.serialize), one per combo. Restore deserializes each value the way
//   vial-gui does (unknown ids become KC_NO) and ignores entries past the count.
//
// Deviations from vial-gui:
// - The status byte of a set is checked; vial-gui ignores it. A failed set
//   throws and leaves the local state unchanged.
// - If the very first get fails (the board advertises combos but does not
//   answer the command), the extension is inactive instead of failing the
//   whole connection as vial-gui's RuntimeError does. A failure on a later
//   entry still throws, as in vial-gui.
// - restore() compares keycodes numerically and only writes entries that
//   differ (vial-gui compares a JSON list to a tuple, which never matches, and
//   so rewrites every combo).
// - describeCombo() (the row summary and restore step text) has no vial-gui
//   counterpart. It follows the firmware: trigger keys after the first KC_NO
//   are listed as ignored.

import { RESET_KEYCODE, type KeycodeTable } from "../keycodes/table.ts";
import { COMBO_INPUTS, vialComboGet, vialComboSet, type ComboEntry } from "../protocol/combos.ts";
import { VIAL_PROTOCOL_DYNAMIC } from "../protocol/constants.ts";
import type { DeviceContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

/** vial-gui passes retries=20 to every combo request. */
const RETRIES = 20;

export class ComboError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComboError";
  }
}

export class Combos {
  private readonly ctx: DeviceContext;
  private readonly values: ComboEntry[];

  constructor(ctx: DeviceContext, entries: ComboEntry[]) {
    this.ctx = ctx;
    this.values = entries;
  }

  /** The board's keycode table, for serializing entries. */
  get keycodes(): KeycodeTable {
    return this.ctx.board.keycodes;
  }

  /** Number of combo slots on the board. */
  get count(): number {
    return this.values.length;
  }

  get entries(): readonly Readonly<ComboEntry>[] {
    return this.values;
  }

  /** combo_get: [key1, key2, key3, key4, output] as integer keycodes. */
  get(idx: number): Readonly<ComboEntry> {
    const entry = this.values[idx];
    if (!entry) throw new ComboError(`combo ${idx} does not exist`);
    return entry;
  }

  /** combo_set: writes one combo when it changed. */
  async set(idx: number, entry: Readonly<ComboEntry>): Promise<void> {
    const current = this.get(idx);
    if (entry.length !== COMBO_INPUTS + 1) throw new ComboError("a combo has 4 trigger keys and 1 output");
    if (entry.every((code, i) => code === current[i])) return;
    const { board, device } = this.ctx;
    if (entry[COMBO_INPUTS] === board.keycodes.resolve(RESET_KEYCODE)) {
      await device.ensureUnlocked("Assigning QK_BOOT (bootloader) to a combo");
    }
    const reply = vialComboSet.decode(
      await device.request(vialComboSet.encode(idx, entry), { retries: RETRIES }),
    );
    if (!reply.ok) throw new ComboError(`the keyboard rejected combo ${idx + 1} (status ${reply.status})`);
    const old = [...current] as ComboEntry;
    const now = [...entry] as ComboEntry;
    this.values[idx] = now;
    this.ctx.history.record({
      label: `Combo ${idx + 1}: ${describeCombo(board.keycodes, now)}`,
      undo: () => this.set(idx, old),
      redo: () => this.set(idx, now),
      isCurrent: () => this.get(idx).every((code, i) => code === now[i]),
    });
    this.ctx.changed();
  }

  /** Replaces one key of a combo: slot 0-3 are the triggers, 4 the output. */
  async setKey(idx: number, slot: number, code: number): Promise<void> {
    if (slot < 0 || slot > COMBO_INPUTS) throw new ComboError(`combo slot ${slot} does not exist`);
    const entry = [...this.get(idx)] as ComboEntry;
    entry[slot] = code;
    await this.set(idx, entry);
  }
}

export const combosExtension: KeyboardExtension<Combos> = {
  id: "combos",
  // Its view shows the combo term from QMK settings when that runs.
  optional: ["qmk-settings"],
  group: "standard",
  name: "Combos",
  description: "Press up to four keys together to send another key. Needs Vial firmware with combos enabled.",

  async probe(ctx) {
    const { board, device } = ctx;
    const count = board.capabilities.dynamic?.combo ?? 0;
    if (board.vialProtocol < VIAL_PROTOCOL_DYNAMIC || count === 0) return null;
    const entries: ComboEntry[] = [];
    for (let idx = 0; idx < count; idx++) {
      const reply = vialComboGet.decode(await device.request(vialComboGet.encode(idx), { retries: RETRIES }));
      if (!reply.ok) {
        if (idx === 0) return null;
        throw new ComboError(`failed retrieving combo entry ${idx} from the device`);
      }
      entries.push(reply.entry);
    }
    return new Combos(ctx, entries);
  },

  vil: {
    keys: ["combo"],
    save: (state) => ({
      combo: state.entries.map((entry) => entry.map((code) => state.keycodes.serialize(code))),
    }),
    restore(state, file) {
      const data = file.combo;
      if (!Array.isArray(data)) return [];
      const steps: ExtensionRestoreStep[] = [];
      data.forEach((raw: unknown, idx) => {
        if (idx >= state.count || !Array.isArray(raw) || raw.length < COMBO_INPUTS + 1) return;
        const table = state.keycodes;
        const unknown: string[] = [];
        const entry = raw.slice(0, COMBO_INPUTS + 1).map((value: unknown) => {
          if (typeof value === "number" && Number.isInteger(value)) return value & 0xffff;
          if (typeof value !== "string") return 0;
          try {
            return table.parse(value);
          } catch {
            unknown.push(value);
            return 0; // Keycode.deserialize falls back to KC_NO
          }
        }) as ComboEntry;
        const current = state.get(idx);
        if (entry.every((code, i) => code === current[i])) return;
        const note = unknown.length ? ` (unknown ${unknown.map((u) => `"${u}"`).join(", ")} as KC_NO)` : "";
        steps.push({
          description: `Set combo ${idx + 1} to ${describeCombo(state.keycodes, entry)}${note}`,
          apply: () => state.set(idx, entry),
        });
      });
      return steps;
    },
  },
};

/**
 * "KC_A + KC_B → KC_ESC". The firmware's combo key list ends at the first
 * KC_NO (vial.c reload_combo() copies the inputs into a COMBO_END (0)
 * terminated array), so only the triggers before the first empty slot are
 * shown; any set after it are named as ignored.
 */
export function describeCombo(table: KeycodeTable, entry: Readonly<ComboEntry>): string {
  const triggers = entry.slice(0, COMBO_INPUTS);
  const end = triggers.indexOf(0);
  const used = end === -1 ? triggers : triggers.slice(0, end);
  const ignored = end === -1 ? [] : triggers.slice(end).filter((code) => code !== 0);
  const left = used.length ? used.map((code) => table.serialize(code)).join(" + ") : "(no keys)";
  const note = ignored.length
    ? ` (ignored after an empty slot: ${ignored.map((code) => table.serialize(code)).join(", ")})`
    : "";
  return `${left} → ${table.serialize(entry[COMBO_INPUTS])}${note}`;
}
