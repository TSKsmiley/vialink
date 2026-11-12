// SPDX-License-Identifier: GPL-2.0-or-later
// QMK settings (Vial protocol 4+), ported from vial-gui's
// editor/qmk_settings.py (QmkSettings: is_qsid_supported, qsid_serialize,
// qsid_deserialize, the tab/field model) and protocol/keyboard_comm.py
// (reload_settings, qmk_settings_set, qmk_settings_reset, the "settings" part
// of save_layout/restore_layout). Firmware side: vial-qmk quantum/vial.c and
// quantum/qmk_settings.c.
//
// data/qmk_settings.json is vial-gui's src/main/resources/base/qmk_settings.json
// (https://github.com/vial-kb/vial-gui at aef8222, GPL-2.0-or-later), copied
// byte for byte (it is in .prettierignore).
//
// Deviations from vial-gui, all deliberate:
// - The supported qsids come from Keyboard.capabilities.qmkSettings (probed
//   once at load); they are not queried again.
// - Writes are write-through: one setting at a time, only when it changed
//   (vial-gui's Save button re-sends every visible qsid). A non-zero status
//   from the board is an error and leaves the state unchanged (vial-gui
//   ignores the status and updates its dict first).
// - A boolean toggle keeps bits the JSON does not describe (vial-gui's
//   prepare_settings rebuilds the value from the known bits only).
// - Settings whose GET fails are hidden (vial-gui would raise on them).
// - restore() only writes qsids the board supports and that differ; vial-gui
//   also sends described-but-unsupported qsids (the firmware rejects them).
// - .vil "settings" keys come out in ascending qsid order. vial-gui writes
//   Python set order, which is ascending for every qsid set vial-qmk can report.
// - No unlock: vial-gui does not call Unlocker for settings, and vial.c does
//   not check vial_unlocked for them.

import { VIAL_PROTOCOL_QMK_SETTINGS } from "../protocol/constants.ts";
import {
  decodeQsidValue,
  vialQmkSettingsGet,
  vialQmkSettingsReset,
  vialQmkSettingsSet,
} from "../protocol/qmk-settings.ts";
import defs from "./data/qmk_settings.json";
import type { ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

// ── The settings description (QmkSettings.initialize) ───────────────────────

export interface QmkSettingField {
  type: "boolean" | "integer";
  title: string;
  qsid: number;
  /** Bytes on the wire; booleans default to 1. */
  width?: number;
  /** Booleans: the bit within the qsid's value; defaults to 0. */
  bit?: number;
  /** Integers: spin box range. */
  min?: number;
  max?: number;
}

export interface QmkSettingsTab {
  name: string;
  fields: QmkSettingField[];
}

export const QMK_SETTINGS_TABS: readonly QmkSettingsTab[] = (defs as { tabs: QmkSettingsTab[] }).tabs;

/** Every field describing a qsid, in JSON order (QmkSettings.qsid_fields). */
const qsidFields = new Map<number, QmkSettingField[]>();
for (const tab of QMK_SETTINGS_TABS) {
  for (const field of tab.fields) {
    const list = qsidFields.get(field.qsid) ?? [];
    list.push(field);
    qsidFields.set(field.qsid, list);
  }
}

/** Whether the settings description covers this qsid (QmkSettings.is_qsid_supported). */
export function isQsidSupported(qsid: number): boolean {
  return qsidFields.has(qsid);
}

export function qsidFieldsOf(qsid: number): readonly QmkSettingField[] {
  return qsidFields.get(qsid) ?? [];
}

/**
 * Bytes a qsid's value takes on the wire, as qsid_serialize/qsid_deserialize
 * pick it: the first field's "width", defaulting to 1 for booleans.
 */
export function qsidWidth(qsid: number): number {
  const first = qsidFields.get(qsid)?.[0];
  if (!first) throw new QmkSettingsError(`qsid ${qsid} is not described in qmk_settings.json`);
  if (first.type === "boolean") return first.width ?? 1;
  if (first.type === "integer" && first.width !== undefined) return first.width;
  throw new QmkSettingsError(`unsupported field for qsid ${qsid}`);
}

/** A short name for a qsid: its field title, or its tab's name when several bits share it. */
export function qsidLabel(qsid: number): string {
  const fields = qsidFieldsOf(qsid);
  if (fields.length === 1) return fields[0].title;
  const tab = QMK_SETTINGS_TABS.find((t) => t.fields.some((f) => f.qsid === qsid));
  return tab ? `${tab.name} options` : `setting ${qsid}`;
}

// ── State ───────────────────────────────────────────────────────────────────

export class QmkSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QmkSettingsError";
  }
}

async function readValue(ctx: ExtensionContext, qsid: number): Promise<number | null> {
  const reply = vialQmkSettingsGet.decode(await ctx.queue.request(vialQmkSettingsGet.encode(qsid)));
  return reply.ok ? decodeQsidValue(reply.data, qsidWidth(qsid)) : null;
}

export class QmkSettings {
  private readonly ctx: ExtensionContext;
  private readonly current: Map<number, number>;

  constructor(ctx: ExtensionContext, values: Map<number, number>) {
    this.ctx = ctx;
    this.current = values;
  }

  /** qsid → value for every setting shown (the keyboard's `settings` dict in vial-gui). */
  get values(): ReadonlyMap<number, number> {
    return this.current;
  }

  /** The qsids shown, ascending. */
  get qsids(): number[] {
    return [...this.current.keys()].sort((a, b) => a - b);
  }

  get(qsid: number): number | undefined {
    return this.current.get(qsid);
  }

  /** The JSON tabs, keeping only fields this board has and skipping empty tabs (recreate_gui). */
  get tabs(): QmkSettingsTab[] {
    return QMK_SETTINGS_TABS.map((tab) => ({
      name: tab.name,
      fields: tab.fields.filter((f) => this.current.has(f.qsid)),
    })).filter((tab) => tab.fields.length > 0);
  }

  /** Writes a qsid's whole value (qmk_settings_set); a no-op when unchanged. */
  async set(qsid: number, value: number): Promise<void> {
    const old = this.current.get(qsid);
    if (old === undefined) throw new QmkSettingsError(`this keyboard has no QMK setting ${qsid}`);
    if (value === old) return;
    const width = qsidWidth(qsid);
    let request: Uint8Array;
    try {
      request = vialQmkSettingsSet.encode(qsid, value, width);
    } catch {
      throw new QmkSettingsError(`${value} is not a valid value for ${qsidLabel(qsid)}`);
    }
    const reply = vialQmkSettingsSet.decode(await this.ctx.queue.request(request));
    if (!reply.ok) {
      throw new QmkSettingsError(
        `the keyboard rejected ${qsidLabel(qsid)} = ${value} (status ${reply.status})`,
      );
    }
    this.current.set(qsid, value);
    this.ctx.record({
      label: `QMK setting ${qsidLabel(qsid)}: ${old} → ${value}`,
      undo: () => this.set(qsid, old),
      redo: () => this.set(qsid, value),
      isCurrent: () => this.current.get(qsid) === value,
    });
    this.ctx.changed();
  }

  /** Sets or clears one bit of a boolean qsid, keeping the other bits. */
  async setBit(qsid: number, bit: number, on: boolean): Promise<void> {
    const old = this.current.get(qsid);
    if (old === undefined) throw new QmkSettingsError(`this keyboard has no QMK setting ${qsid}`);
    const mask = 2 ** bit;
    const isOn = Math.floor(old / mask) % 2 === 1;
    if (isOn === on) return;
    await this.set(qsid, on ? old + mask : old - mask);
  }

  /** Whether a boolean field is checked (BooleanOption.reload). */
  isChecked(field: QmkSettingField): boolean {
    const value = this.current.get(field.qsid) ?? 0;
    return Math.floor(value / 2 ** (field.bit ?? 0)) % 2 === 1;
  }

  /** Resets every setting to the firmware defaults, then reads them back (reset_settings). */
  async reset(): Promise<void> {
    // keyboard_comm.py qmk_settings_reset sends this once, without retries.
    await this.ctx.queue.request(vialQmkSettingsReset.encode(), { retries: 1 });
    await this.reload();
  }

  /** Reads every shown setting again. */
  async reload(): Promise<void> {
    const failed: number[] = [];
    for (const qsid of this.qsids) {
      const value = await readValue(this.ctx, qsid);
      if (value === null) failed.push(qsid);
      else this.current.set(qsid, value);
    }
    this.ctx.changed();
    if (failed.length > 0) {
      throw new QmkSettingsError(`could not read QMK settings ${failed.join(", ")} back from the keyboard`);
    }
  }
}

// ── The extension ───────────────────────────────────────────────────────────

/** A .vil settings value: an int, or a bool (Python's json gives True/False, which are ints). */
function fileValue(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export const qmkSettingsExtension: KeyboardExtension<QmkSettings> = {
  id: "qmk-settings",
  group: "standard",
  name: "QMK settings",
  description:
    "Tap-hold timing, Magic, Auto Shift, combos, one-shot and mouse keys settings stored on the keyboard (Vial protocol 4+).",

  async probe(ctx) {
    const { keyboard } = ctx;
    // QmkSettings.valid(): Vial protocol ≥ 4 and at least one supported qsid.
    if (keyboard.vialProtocol < VIAL_PROTOCOL_QMK_SETTINGS) return null;
    const values = new Map<number, number>();
    // reload_settings: GET every qsid the board reports and the JSON describes;
    // keep the ones whose status is 0.
    for (const qsid of keyboard.capabilities.qmkSettings) {
      if (!isQsidSupported(qsid)) continue;
      const value = await readValue(ctx, qsid);
      if (value !== null) values.set(qsid, value);
    }
    return values.size > 0 ? new QmkSettings(ctx, values) : null;
  },

  vil: {
    keys: ["settings"],
    // save_layout: data["settings"] = self.settings; json.dumps turns the int keys into strings.
    save: (state) => ({
      settings: Object.fromEntries(state.qsids.map((qsid) => [String(qsid), state.get(qsid)])),
    }),
    restore(state, file) {
      const settings = file.settings;
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return [];
      const steps: ExtensionRestoreStep[] = [];
      for (const [key, raw] of Object.entries(settings as Record<string, unknown>)) {
        // restore_layout: qsid = int(qsid); only qsids QmkSettings describes.
        if (!/^\s*[+-]?\d+\s*$/.test(key)) continue;
        const qsid = Number.parseInt(key, 10);
        if (!isQsidSupported(qsid)) continue;
        const current = state.get(qsid);
        const value = fileValue(raw);
        if (current === undefined || value === null || value === current) continue;
        steps.push({
          description: `Set QMK setting "${qsidLabel(qsid)}" to ${value}`,
          apply: () => state.set(qsid, value),
        });
      }
      return steps;
    },
  },
};
