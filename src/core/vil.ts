// SPDX-License-Identifier: GPL-2.0-or-later
// .vil layout files, compatible with vial-gui's keyboard_comm.py
// save_layout()/restore_layout(). Ideas adapted from Vialite's
// src/protocol/vilFile.ts (https://github.com/tcyeee/vialite, GPL-2.0): the uid
// is handled as a BigInt from the raw text, and "macro" is left out on save.
//
// Milestone 1 reads and writes the keymap fields only. On save, fields vial-ts
// does not read from the board yet (macro, tap_dance, combo, key_override,
// alt_repeat_key, settings) are left out: vial-gui's restore skips missing
// fields, whereas an empty list would erase that feature on the board. On load
// they are reported, not applied.

import type { Keyboard } from "./keyboard.ts";
import type { KeycodeTable } from "./keycodes/table.ts";

export interface VilFile {
  version: number;
  uid: bigint | null;
  /** [layer][row][col]: qmk id string, legacy integer keycode, or -1 for no key. */
  layout: unknown[][][];
  /** [layer][encoder] = [ccw, cw]. */
  encoderLayout: unknown[][][];
  /** Packed value, or -1 when absent. */
  layoutOptions: number;
  viaProtocol: number | null;
  vialProtocol: number | null;
  /** From the Theis194 layer-names fork; null when absent. */
  layerNames: string[] | null;
  /** Fields this version does not apply but which carry real data. */
  skippedFeatures: string[];
}

export class VilFormatError extends Error {
  constructor(message: string) {
    super(`Not a valid .vil file: ${message}`);
    this.name = "VilFormatError";
  }
}

// ── Save ────────────────────────────────────────────────────────────────────

/** Serializes the keyboard's current state in vial-gui's field order and JSON style. */
export function saveVil(kb: Keyboard): string {
  const layout: (string | number)[][][] = [];
  for (let l = 0; l < kb.layers; l++) {
    const layer: (string | number)[][] = [];
    for (let r = 0; r < kb.rows; r++) {
      const row: (string | number)[] = [];
      for (let c = 0; c < kb.cols; c++) {
        const code = kb.getKey(l, r, c);
        row.push(code === undefined ? -1 : kb.keycodes.serialize(code));
      }
      layer.push(row);
    }
    layout.push(layer);
  }

  const encoderLayout: (string | number)[][][] = [];
  for (let l = 0; l < kb.layers; l++) {
    const layer: (string | number)[][] = [];
    for (let e = 0; e < kb.encoderCount; e++) {
      const ccw = kb.getEncoder(l, e, 0);
      const cw = kb.getEncoder(l, e, 1);
      layer.push([
        ccw === undefined ? -1 : kb.keycodes.serialize(ccw),
        cw === undefined ? -1 : kb.keycodes.serialize(cw),
      ]);
    }
    encoderLayout.push(layer);
  }

  const fields: [string, unknown][] = [
    ["version", 1],
    ["uid", kb.uid],
    ["layout", layout],
    ["encoder_layout", encoderLayout],
    ["layout_options", kb.layoutOptions],
    ["vial_protocol", kb.vialProtocol],
    ["via_protocol", kb.viaProtocol],
  ];
  if (kb.capabilities.layerNames) fields.push(["layer_names", kb.layerNames.slice(0, kb.layers)]);
  return pythonJson(Object.fromEntries(fields));
}

/**
 * JSON in the exact style of Python's json.dumps() defaults: ", " and ": "
 * separators and non-ASCII escaped as \uXXXX. BigInts are written as integers.
 */
export function pythonJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot serialize non-finite number");
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    return JSON.stringify(value).replace(
      /[\u007f-￿]/g,
      (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  }
  if (Array.isArray(value)) return "[" + value.map(pythonJson).join(", ") + "]";
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${pythonJson(k)}: ${pythonJson(v)}`);
    return "{" + parts.join(", ") + "}";
  }
  throw new Error(`cannot serialize ${typeof value}`);
}

// ── Load ────────────────────────────────────────────────────────────────────

export function parseVil(text: string): VilFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new VilFormatError("malformed JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new VilFormatError("expected a JSON object");
  }
  const obj = data as Record<string, unknown>;
  if (!isNested(obj.layout, 3)) throw new VilFormatError('missing or malformed "layout"');
  if (obj.encoder_layout !== undefined && !isNested(obj.encoder_layout, 2)) {
    throw new VilFormatError('malformed "encoder_layout"');
  }

  // The uid can exceed 2^53, so read it from the text rather than the parsed number.
  const uidMatch = /"uid"\s*:\s*(\d+)/.exec(text);
  const intOrNull = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const layerNames =
    Array.isArray(obj.layer_names) && obj.layer_names.every((n) => typeof n === "string")
      ? (obj.layer_names as string[])
      : null;

  return {
    version: intOrNull(obj.version) ?? 1,
    uid: uidMatch ? BigInt(uidMatch[1]) : null,
    layout: obj.layout as unknown[][][],
    encoderLayout: (obj.encoder_layout as unknown[][][] | undefined) ?? [],
    layoutOptions: intOrNull(obj.layout_options) ?? -1,
    viaProtocol: intOrNull(obj.via_protocol),
    vialProtocol: intOrNull(obj.vial_protocol),
    layerNames,
    skippedFeatures: detectSkippedFeatures(obj),
  };
}

export type RestoreOp =
  | { kind: "key"; layer: number; row: number; col: number; code: number }
  | { kind: "encoder"; layer: number; index: number; direction: 0 | 1; code: number }
  | { kind: "layoutOptions"; value: number };

export interface RestorePlan {
  /** Only entries that differ from the board's current state. */
  ops: RestoreOp[];
  uidMismatch: boolean;
  /** File entries that could not be parsed as keycodes (written as KC_NO by vial-gui; skipped here). */
  unknownKeycodes: string[];
  /** Positions in the file the board does not have (extra layers, keys or encoders). */
  ignoredEntries: number;
  skippedFeatures: string[];
}

/**
 * Works out the writes restore_layout() would make. Keycodes go through
 * serialize(deserialize(x)), as in vial-gui, so legacy integers and aliases
 * normalize the same way.
 */
export function planVilRestore(kb: Keyboard, file: VilFile): RestorePlan {
  const ops: RestoreOp[] = [];
  const unknown = new Set<string>();
  let ignored = 0;

  file.layout.forEach((layer, l) =>
    layer.forEach((row, r) =>
      row.forEach((entry, c) => {
        if (entry === -1) return;
        const current = kb.getKey(l, r, c);
        if (current === undefined) {
          ignored++;
          return;
        }
        const code = toKeycode(kb.keycodes, entry, unknown);
        if (code !== null && code !== current) ops.push({ kind: "key", layer: l, row: r, col: c, code });
      }),
    ),
  );

  file.encoderLayout.forEach((layer, l) =>
    layer.forEach((pair, e) => {
      if (!Array.isArray(pair)) return;
      ([0, 1] as const).forEach((direction) => {
        const entry = pair[direction];
        if (entry === undefined || entry === -1) return;
        const current = kb.getEncoder(l, e, direction);
        if (current === undefined) {
          ignored++;
          return;
        }
        const code = toKeycode(kb.keycodes, entry, unknown);
        if (code !== null && code !== current)
          ops.push({ kind: "encoder", layer: l, index: e, direction, code });
      });
    }),
  );

  if (kb.layoutOptions !== -1 && file.layoutOptions !== -1 && file.layoutOptions !== kb.layoutOptions) {
    ops.push({ kind: "layoutOptions", value: file.layoutOptions });
  }

  return {
    ops,
    uidMismatch: file.uid !== null && file.uid !== kb.uid,
    unknownKeycodes: [...unknown],
    ignoredEntries: ignored,
    skippedFeatures: file.skippedFeatures,
  };
}

/** Applies a plan to the board, one write at a time. */
export async function applyVilRestore(
  kb: Keyboard,
  plan: RestorePlan,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = plan.ops.length;
  onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    const op = plan.ops[i];
    if (op.kind === "key") await kb.setKey(op.layer, op.row, op.col, op.code);
    else if (op.kind === "encoder") await kb.setEncoder(op.layer, op.index, op.direction, op.code);
    else await kb.setLayoutOptions(op.value);
    onProgress?.(i + 1, total);
  }
}

function toKeycode(table: KeycodeTable, entry: unknown, unknown: Set<string>): number | null {
  if (typeof entry === "number") {
    return Number.isInteger(entry) && entry >= 0 && entry <= 0xffff ? entry : null;
  }
  if (typeof entry !== "string") return null;
  try {
    return table.parse(entry);
  } catch {
    unknown.add(entry);
    return null;
  }
}

function isNested(value: unknown, depth: number): boolean {
  if (!Array.isArray(value)) return false;
  return depth <= 1 || value.every((v) => isNested(v, depth - 1));
}

/**
 * Reports unapplied features only when they hold real data: vial-gui writes
 * e.g. a full tap_dance list of KC_NO entries for boards that never used it.
 * Adapted from Vialite's vilFile.ts.
 */
function detectSkippedFeatures(obj: Record<string, unknown>): string[] {
  const skipped: string[] = [];
  const realKeycode = (v: unknown): boolean => typeof v === "string" && v !== "KC_NO" && v !== "KC_TRNS";
  const hasKeycode = (entry: unknown): boolean => Array.isArray(entry) && entry.some(realKeycode);

  if (Array.isArray(obj.macro) && obj.macro.some((m) => Array.isArray(m) && m.length > 0))
    skipped.push("macros");
  if (Array.isArray(obj.tap_dance) && obj.tap_dance.some(hasKeycode)) skipped.push("tap dance");
  if (Array.isArray(obj.combo) && obj.combo.some(hasKeycode)) skipped.push("combos");
  const enabled = (entry: unknown, bit: number) =>
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as Record<string, unknown>).options === "number" &&
    ((entry as Record<string, number>).options & bit) !== 0;
  if (Array.isArray(obj.key_override) && obj.key_override.some((e) => enabled(e, 1 << 7))) {
    skipped.push("key overrides");
  }
  if (Array.isArray(obj.alt_repeat_key) && obj.alt_repeat_key.some((e) => enabled(e, 1 << 3))) {
    skipped.push("alt repeat keys");
  }
  if (typeof obj.settings === "object" && obj.settings !== null && Object.keys(obj.settings).length > 0) {
    skipped.push("QMK settings");
  }
  if (Array.isArray(obj.layer_names) && obj.layer_names.some((n) => typeof n === "string" && n !== "")) {
    skipped.push("layer names");
  }
  return skipped;
}
