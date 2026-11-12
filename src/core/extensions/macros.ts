// SPDX-License-Identifier: GPL-2.0-or-later
// Macros, as vial-gui's protocol/macro.py (ProtocolMacro) and
// editor/macro_recorder.py implement them:
// - load: reload_macros_late reads the buffer 28 bytes at a time with
//   CMD_VIA_MACRO_GET_BUFFER, stops once it has seen more NULs than macros,
//   and keeps exactly macro_count NUL-terminated macros;
// - write: set_macro sends the whole buffer with CMD_VIA_MACRO_SET_BUFFER after
//   Unlocker.unlock (MacroRecorder.on_save, restore_macros);
// - .vil: "macro" is save_macro()'s list of macros, each a list of act.save()
//   lists; restore_macros pads/cuts to macro_count, serializes, truncates to
//   macro_memory and writes when the result differs from the board.
// Count and memory come from Keyboard.load (reload_macros_early).
//
// Deviations from vial-gui:
// - The extension is inactive when the board reports no macro memory (vial-gui
//   still saves "macro": [[], ...] for such boards; nothing can be stored there).
// - restore() lists one step per macro that differs; the first step to run
//   writes the whole target buffer (one set_macro, as vial-gui does) and the
//   rest find the board already matching.
// - Actions vial-gui would crash on while restoring (delays below protocol 2,
//   delays it cannot encode, non-string text) are dropped instead.

import { BUFFER_FETCH_CHUNK } from "../protocol/constants.ts";
import {
  cleanMacroBuffer,
  deserializeMacro,
  deserializeMacros,
  describeMacro,
  enoughMacrosRead,
  equalBytes,
  MacroError,
  macroPieces,
  restoreMacroAction,
  saveMacroAction,
  serializeMacro,
  serializeMacros,
  viaMacroGetBuffer,
  viaMacroSetBuffer,
  type MacroAction,
} from "../protocol/macros.ts";
import { concat } from "../util/bytes.ts";
import type { ExtensionContext, ExtensionRestoreStep, KeyboardExtension } from "./types.ts";

export { MacroError };

/** Reads the macro buffer the way reload_macros_late does (cleaned up when memory > 0). */
export async function readMacroBuffer(
  ctx: ExtensionContext,
  count: number,
  memory: number,
): Promise<Uint8Array> {
  if (!memory) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let data: Uint8Array = new Uint8Array(0);
  for (let x = 0; x < memory; x += BUFFER_FETCH_CHUNK) {
    const sz = Math.min(BUFFER_FETCH_CHUNK, memory - x);
    const reply = await ctx.queue.request(viaMacroGetBuffer.encode(x, sz));
    chunks.push(reply.slice(4, 4 + sz));
    data = concat(chunks);
    if (enoughMacrosRead(data, count)) break;
  }
  return cleanMacroBuffer(data, count);
}

export class Macros {
  private readonly ctx: ExtensionContext;
  readonly count: number;
  readonly memory: number;
  private data: Uint8Array;

  constructor(ctx: ExtensionContext, count: number, memory: number, buffer: Uint8Array) {
    this.ctx = ctx;
    this.count = count;
    this.memory = memory;
    this.data = buffer;
  }

  get vialProtocol(): number {
    return this.ctx.keyboard.vialProtocol;
  }

  /** The buffer as last read from or written to the board (keyboard.macro in vial-gui). */
  get buffer(): Uint8Array {
    return this.data;
  }

  /** Every macro, decoded afresh (callers may edit the result). */
  get macros(): MacroAction[][] {
    return deserializeMacros(this.data, this.count, this.vialProtocol, this.ctx.keyboard.keycodes);
  }

  /** The raw bytes of each macro on the board, without terminators. */
  get pieces(): Uint8Array[] {
    return macroPieces(this.data, this.count);
  }

  /** macros_serialize for this board; throws MacroError on actions it cannot encode. */
  serialize(macros: readonly (readonly MacroAction[])[]): Uint8Array {
    return serializeMacros(macros, this.count, this.vialProtocol, this.ctx.keyboard.keycodes);
  }

  /** Bytes one macro takes, without its terminator. */
  serializeMacro(actions: readonly MacroAction[]): Uint8Array {
    return serializeMacro(actions, this.vialProtocol, this.ctx.keyboard.keycodes);
  }

  /** decode then encode, as MacroRecorder.on_stop does to merge adjacent actions. */
  normalize(actions: readonly MacroAction[]): MacroAction[] {
    return deserializeMacro(this.serializeMacro(actions), this.vialProtocol, this.ctx.keyboard.keycodes);
  }

  /** MacroRecorder.on_save: writes every macro when the result differs from the board. */
  async setMacros(macros: readonly (readonly MacroAction[])[]): Promise<void> {
    await this.writeBuffer(this.serialize(macros));
  }

  /**
   * set_macro: writes the whole buffer in 28-byte chunks after an unlock.
   * Does nothing when the board already holds exactly these bytes.
   */
  async writeBuffer(data: Uint8Array): Promise<void> {
    if (data.length > this.memory) {
      throw new MacroError(`the macro is too big: got ${data.length} max ${this.memory}`);
    }
    if (equalBytes(data, this.data)) return;
    await this.ctx.keyboard.ensureUnlocked("Saving macros");
    for (let off = 0; off < data.length; off += BUFFER_FETCH_CHUNK) {
      const chunk = data.slice(off, off + BUFFER_FETCH_CHUNK);
      await this.ctx.queue.request(viaMacroSetBuffer.encode(off, chunk));
    }
    const old = this.data;
    const now = data.slice();
    this.data = now;
    this.ctx.record({
      label: "Save macros",
      undo: () => this.writeBuffer(old),
      redo: () => this.writeBuffer(now),
      isCurrent: () => equalBytes(this.data, now),
    });
    this.ctx.changed();
  }

  /** MacroRecorder.on_revert: reads the buffer from the board again. */
  async reload(): Promise<void> {
    this.data = await readMacroBuffer(this.ctx, this.count, this.memory);
    this.ctx.changed();
  }
}

/** restore_macros' parse of the "macro" field, padded/cut to `count`. */
function macrosFromFile(value: unknown, macros: Macros): MacroAction[][] {
  const out: MacroAction[][] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const actions: MacroAction[] = [];
    for (const act of Array.isArray(entry) ? entry : []) {
      const action = restoreMacroAction(act);
      if (!action) continue;
      try {
        macros.serializeMacro([action]); // drops what vial-gui would crash on
      } catch {
        continue;
      }
      actions.push(action);
    }
    out.push(actions);
  }
  while (out.length < macros.count) out.push([]);
  return out.slice(0, macros.count);
}

export const macrosExtension: KeyboardExtension<Macros> = {
  id: "macros",
  standard: true,
  name: "Macros",
  description: "Edit the keyboard's dynamic macros (M0, M1, ...) and keep them in .vil files.",

  async probe(ctx) {
    const { macroCount, macroMemory } = ctx.keyboard;
    if (macroCount <= 0 || macroMemory <= 0) return null;
    const buffer = await readMacroBuffer(ctx, macroCount, macroMemory);
    return new Macros(ctx, macroCount, macroMemory, buffer);
  },

  vil: {
    keys: ["macro"],
    save: (state) => ({ macro: state.macros.map((m) => m.map(saveMacroAction)) }),
    restore(state, file) {
      const value = file.macro;
      if (!Array.isArray(value)) return [];
      const wanted = macrosFromFile(value, state);
      // TODO in vial-gui too: the cut is silent when the file does not fit.
      const data = state.serialize(wanted).slice(0, state.memory);
      if (equalBytes(data, state.buffer)) return [];

      const write = () => state.writeBuffer(data);
      const target = macroPieces(data, state.count);
      const current = state.pieces;
      const steps: ExtensionRestoreStep[] = [];
      for (let i = 0; i < state.count; i++) {
        if (equalBytes(target[i], current[i])) continue;
        steps.push({ description: `Set macro M${i}: ${describeMacro(wanted[i])}`, apply: write });
      }
      // Only the terminators differ (e.g. a truncated file): still one write.
      if (steps.length === 0) steps.push({ description: "Rewrite the macro buffer", apply: write });
      return steps;
    },
  },
};
