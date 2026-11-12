// SPDX-License-Identifier: GPL-2.0-or-later
// Macros: buffer commands and the byte format of the macro buffer.
// Ported from vial-gui (https://github.com/vial-kb/vial-gui, GPL-2.0-or-later):
// - src/main/python/protocol/macro.py: macro_deserialize_v1/v2,
//   reload_macros_late (buffer read and clean-up), set_macro (buffer write),
//   macros_serialize/macros_deserialize, save_macro/restore_macros;
// - src/main/python/macro/macro_action.py: the action types, SS_* and
//   VIAL_MACRO_EXT_* codes, serialize() and the .vil save()/restore() tags.
// The firmware side is vial-qmk quantum/via.c (id_dynamic_keymap_macro_*),
// quantum/dynamic_keymap.c (decode_keycode, dynamic_keymap_macro_send) and
// quantum/nvm/eeprom/nvm_dynamic_keymap.c.
//
// Deviations: vial-gui raises (RuntimeError / struct.error) on a delay action
// below Vial protocol 2 or a delay outside 0..65024 ms; here those throw a
// MacroError too, and callers (restore planning) drop such actions instead of
// crashing. Everything else is byte-for-byte the same, including vial-gui's
// quirks: text is decoded one byte per character (chr(byte), so UTF-8 text
// comes back as Latin-1 characters) but encoded as UTF-8, and a keycode >= 256
// on protocol < 2 is written with the extended prefix but no SS_QMK_PREFIX.

import { be16, bytes, concat } from "../util/bytes.ts";
import * as C from "./constants.ts";
import type { Command } from "./commands.ts";

// ── Codes (macro/macro_action.py) ───────────────────────────────────────────

export const SS_QMK_PREFIX = 1;
export const SS_TAP_CODE = 1;
export const SS_DOWN_CODE = 2;
export const SS_UP_CODE = 3;
export const SS_DELAY_CODE = 4;
export const VIAL_MACRO_EXT_TAP = 5;
export const VIAL_MACRO_EXT_DOWN = 6;
export const VIAL_MACRO_EXT_UP = 7;

/** Largest delay ActionDelay can encode: struct.pack("BBBB", 1, 4, d % 255 + 1, d // 255 + 1). */
export const MACRO_MAX_DELAY_ENCODABLE = 254 * 255 + 254;
/** vial-gui's ActionDelayUI spin box maximum ("up to 64s"). */
export const MACRO_MAX_DELAY_UI = 64000;

export class MacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroError";
  }
}

// ── Commands (protocol/macro.py) ────────────────────────────────────────────

/** ">BHB" offset,size → reply echoes the header, data at [4, 4+size). size ≤ 28 (via.c). */
export const viaMacroGetBuffer: Command<[offset: number, size: number], Uint8Array> = {
  encode: (offset, size) => bytes(C.CMD_VIA_MACRO_GET_BUFFER, be16(offset), size),
  decode: (r) => r.slice(4, 4 + Math.min(r[3], C.BUFFER_FETCH_CHUNK)),
};

/**
 * ">BHB" offset,len(chunk) followed by the chunk (set_macro). The reply is an
 * echo; vial.c leaves it untouched (no error) while the board is locked.
 */
export const viaMacroSetBuffer: Command<[offset: number, chunk: Uint8Array], void> = {
  encode: (offset, chunk) => {
    if (chunk.length > C.BUFFER_FETCH_CHUNK) {
      throw new MacroError(`a macro buffer chunk is at most ${C.BUFFER_FETCH_CHUNK} bytes`);
    }
    return bytes(C.CMD_VIA_MACRO_SET_BUFFER, be16(offset), chunk.length, chunk);
  },
  decode: () => undefined,
};

// ── Actions (macro/macro_action.py) ─────────────────────────────────────────

export type MacroSequenceKind = "tap" | "down" | "up";

/** One macro action. Keycodes are QMK id strings (or legacy integers), as in vial-gui. */
export type MacroAction =
  | { type: "text"; text: string }
  | { type: MacroSequenceKind; keys: (string | number)[] }
  | { type: "delay"; delay: number };

/** The two keycode conversions macros need; KeycodeTable provides both. */
export interface MacroKeycodes {
  serialize(code: number): string;
  /** Returns 0 for anything unparseable, as vial-gui's Keycode.deserialize does. */
  deserialize(value: string | number): number;
}

const SHORT_CODE: Record<MacroSequenceKind, number> = {
  tap: SS_TAP_CODE,
  down: SS_DOWN_CODE,
  up: SS_UP_CODE,
};
const EXT_CODE: Record<MacroSequenceKind, number> = {
  tap: VIAL_MACRO_EXT_TAP,
  down: VIAL_MACRO_EXT_DOWN,
  up: VIAL_MACRO_EXT_UP,
};
const KIND_OF: Record<number, MacroSequenceKind> = {
  [SS_TAP_CODE]: "tap",
  [SS_DOWN_CODE]: "down",
  [SS_UP_CODE]: "up",
};

/** ActionX.serialize(vial_protocol) for one action. */
export function serializeAction(action: MacroAction, vialProtocol: number, kc: MacroKeycodes): Uint8Array {
  if (action.type === "text") return new TextEncoder().encode(action.text);
  if (action.type === "delay") {
    if (vialProtocol < C.VIAL_PROTOCOL_ADVANCED_MACROS) {
      throw new MacroError("delay actions need Vial protocol 2 or newer");
    }
    const d = action.delay;
    if (!Number.isInteger(d) || d < 0 || d > MACRO_MAX_DELAY_ENCODABLE) {
      throw new MacroError(`a delay must be a whole number from 0 to ${MACRO_MAX_DELAY_ENCODABLE} ms`);
    }
    // struct.pack("BBBB", SS_QMK_PREFIX, SS_DELAY_CODE, (delay % 255) + 1, (delay // 255) + 1)
    return Uint8Array.of(SS_QMK_PREFIX, SS_DELAY_CODE, (d % 255) + 1, Math.floor(d / 255) + 1);
  }
  const out: number[] = [];
  for (const key of action.keys) {
    if (vialProtocol >= C.VIAL_PROTOCOL_ADVANCED_MACROS) out.push(SS_QMK_PREFIX);
    let code = kc.deserialize(key);
    if (code < 256) {
      out.push(SHORT_CODE[action.type], code); // "B"
    } else {
      out.push(EXT_CODE[action.type]);
      // see decode_keycode() in qmk: 0xXX00 is sent as 0xFFXX so the word has no NUL byte.
      if (code % 256 === 0) code = 0xff00 | (code >> 8);
      out.push(code & 0xff, (code >> 8) & 0xff); // "<H"
    }
  }
  return Uint8Array.from(out);
}

/** ProtocolMacro.macro_serialize: one macro, without its NUL terminator. */
export function serializeMacro(
  actions: readonly MacroAction[],
  vialProtocol: number,
  kc: MacroKeycodes,
): Uint8Array {
  const parts = actions.map((a) => serializeAction(a, vialProtocol, kc));
  return concat(parts);
}

/** ProtocolMacro.macros_serialize: every macro, each followed by a NUL. */
export function serializeMacros(
  macros: readonly (readonly MacroAction[])[],
  count: number,
  vialProtocol: number,
  kc: MacroKeycodes,
): Uint8Array {
  if (macros.length !== count) {
    throw new MacroError(`expected array with ${count} macros, got ${macros.length} macros`);
  }
  const parts: Uint8Array[] = [];
  for (const m of macros) parts.push(serializeMacro(m, vialProtocol, kc), Uint8Array.of(0));
  return concat(parts);
}

type Pending = string | { kind: MacroSequenceKind; codes: number[] } | { kind: "delay"; delay: number };

function appendChar(seq: Pending[], byte: number): void {
  // ch = chr(data[0]): one character per byte.
  const ch = String.fromCharCode(byte);
  const last = seq[seq.length - 1];
  if (typeof last === "string") seq[seq.length - 1] = last + ch;
  else seq.push(ch);
}

function appendCode(seq: Pending[], kind: MacroSequenceKind, code: number): void {
  const last = seq[seq.length - 1];
  if (typeof last === "object" && last.kind === kind) last.codes.push(code);
  else seq.push({ kind, codes: [code] });
}

function toActions(seq: Pending[], kc: MacroKeycodes): MacroAction[] {
  return seq.map((s): MacroAction => {
    if (typeof s === "string") return { type: "text", text: s };
    if (s.kind === "delay") return { type: "delay", delay: s.delay };
    return { type: s.kind, keys: s.codes.map((c) => kc.serialize(c)) };
  });
}

/** macro_deserialize_v1: Vial protocol < 2 (no prefix byte, no delays, 1-byte keycodes). */
export function deserializeMacroV1(data: Uint8Array, kc: MacroKeycodes): MacroAction[] {
  const seq: Pending[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    if (b === SS_TAP_CODE || b === SS_DOWN_CODE || b === SS_UP_CODE) {
      if (data.length - i < 2) break;
      appendCode(seq, KIND_OF[b], data[i + 1]);
      i += 2;
    } else {
      appendChar(seq, b);
      i += 1;
    }
  }
  return toActions(seq, kc);
}

/** macro_deserialize_v2: Vial protocol ≥ 2 (SS_QMK_PREFIX, delays, extended 2-byte keycodes). */
export function deserializeMacroV2(data: Uint8Array, kc: MacroKeycodes): MacroAction[] {
  const seq: Pending[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] !== SS_QMK_PREFIX) {
      appendChar(seq, data[i]);
      i += 1;
      continue;
    }
    const left = data.length - i;
    if (left < 2) break;
    const act = data[i + 1];
    if (act === SS_TAP_CODE || act === SS_DOWN_CODE || act === SS_UP_CODE) {
      if (left < 3) break;
      appendCode(seq, KIND_OF[act], data[i + 2]);
      i += 3;
    } else if (act === VIAL_MACRO_EXT_TAP || act === VIAL_MACRO_EXT_DOWN || act === VIAL_MACRO_EXT_UP) {
      if (left < 4) break;
      let code = data[i + 2] | (data[i + 3] << 8); // "<H"
      if (code > 0xff00) code = (code & 0xff) << 8; // see decode_keycode() in qmk
      appendCode(seq, KIND_OF[act - 4], code);
      i += 4;
    } else if (act === SS_DELAY_CODE) {
      if (left < 4) break;
      seq.push({ kind: "delay", delay: data[i + 2] - 1 + (data[i + 3] - 1) * 255 });
      i += 4;
    } else {
      // "it is clearly malformed, just skip this byte and hope for the best" (skips two)
      i += 2;
    }
  }
  return toActions(seq, kc);
}

/** ProtocolMacro.macro_deserialize: picks the format by Vial protocol. */
export function deserializeMacro(data: Uint8Array, vialProtocol: number, kc: MacroKeycodes): MacroAction[] {
  return vialProtocol >= C.VIAL_PROTOCOL_ADVANCED_MACROS
    ? deserializeMacroV2(data, kc)
    : deserializeMacroV1(data, kc);
}

/** Python's bytes.split(b"\x00"): every NUL splits, empty pieces kept. */
export function splitNul(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      out.push(data.slice(start, i));
      start = i + 1;
    }
  }
  out.push(data.slice(start));
  return out;
}

/** macros_deserialize: the raw piece of each macro (split, padded with b"", cut to count). */
export function macroPieces(data: Uint8Array, count: number): Uint8Array[] {
  const pieces = splitNul(data);
  while (pieces.length < count) pieces.push(new Uint8Array(0));
  return pieces.slice(0, count);
}

/** ProtocolMacro.macros_deserialize. */
export function deserializeMacros(
  data: Uint8Array,
  count: number,
  vialProtocol: number,
  kc: MacroKeycodes,
): MacroAction[][] {
  return macroPieces(data, count).map((p) => deserializeMacro(p, vialProtocol, kc));
}

/**
 * The clean-up at the end of reload_macros_late: keep exactly `count`
 * NUL-terminated macros. Only applied when the board has macro memory.
 */
export function cleanMacroBuffer(raw: Uint8Array, count: number): Uint8Array {
  const pieces = macroPieces(raw, count);
  const parts: Uint8Array[] = [];
  for (const p of pieces) parts.push(p, Uint8Array.of(0));
  return concat(parts);
}

/** reload_macros_late's early stop: more NULs read than there are macros. */
export function enoughMacrosRead(data: Uint8Array, count: number): boolean {
  let nuls = 0;
  for (const b of data) if (b === 0) nuls++;
  return nuls > count;
}

// ── .vil format (BasicAction.save / restore, tag_to_action) ─────────────────

/** act.save(): ["text", s], ["tap"|"down"|"up", kc...], ["delay", ms]. */
export function saveMacroAction(action: MacroAction): unknown[] {
  if (action.type === "text") return ["text", action.text];
  if (action.type === "delay") return ["delay", action.delay];
  return [action.type, ...action.keys];
}

/**
 * tag_to_action[act[0]]().restore(act). Returns null for entries vial-gui
 * skips (unknown tag) and for entries it would crash on (wrong value types).
 */
export function restoreMacroAction(act: unknown): MacroAction | null {
  if (!Array.isArray(act) || act.length === 0) return null;
  const [tag, ...rest] = act as unknown[];
  switch (tag) {
    case "text":
      return typeof rest[0] === "string" ? { type: "text", text: rest[0] } : null;
    case "delay":
      return typeof rest[0] === "number" && Number.isInteger(rest[0])
        ? { type: "delay", delay: rest[0] }
        : null;
    case "tap":
    case "down":
    case "up":
      return {
        type: tag,
        keys: rest.filter((k): k is string | number => typeof k === "string" || typeof k === "number"),
      };
    default:
      return null;
  }
}

/** Short human-readable form, e.g. 'tap KC_A KC_B', 'text "hi"', 'delay 100 ms'. */
export function describeAction(action: MacroAction): string {
  if (action.type === "text") return `text ${JSON.stringify(action.text)}`;
  if (action.type === "delay") return `delay ${action.delay} ms`;
  return `${action.type} ${action.keys.join(" ")}`.trimEnd();
}

export function describeMacro(actions: readonly MacroAction[], max = 60): string {
  if (actions.length === 0) return "empty";
  const text = actions.map(describeAction).join(", ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
