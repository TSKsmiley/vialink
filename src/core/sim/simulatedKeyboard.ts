// SPDX-License-Identifier: GPL-2.0-or-later
// A software Vial keyboard for tests and the demo mode: answers VIA/Vial
// commands the way vial-qmk's quantum/via.c and quantum/vial.c do, including
// writes. Modelled on vial-gui's protocol/dummy_keyboard.py and the
// SimulatedDevice in its test/test_keyboard.py.

import { be16, be32, le32, u16be, u16le, u32be, u32le } from "../util/bytes.ts";
import * as C from "../protocol/constants.ts";
import { UNLOCK_COUNTER_MAX } from "../unlock.ts";
import {
  DeviceDisconnectedError,
  MSG_LEN,
  TransportTimeoutError,
  type DeviceInfo,
  type Transport,
} from "../transport/types.ts";

export interface SimulatedKeyboardOptions {
  info?: DeviceInfo;
  viaProtocol?: number;
  vialProtocol?: number;
  uid?: bigint;
  /** XZ-compressed vial.json, as stored in firmware. */
  compressedDefinition: Uint8Array;
  rows: number;
  cols: number;
  layers: number;
  /** Initial keymap, [layer][row][col]; missing entries are KC_NO. */
  keymap?: number[][][];
  /** Number of encoders and their initial [layer][index] = [ccw, cw]. */
  encoderCount?: number;
  encoders?: [number, number][][];
  layoutOptions?: number;
  macroCount?: number;
  macroBufferSize?: number;
  dynamic?: {
    tapDance: number;
    combo: number;
    keyOverride: number;
    altRepeatKey: number;
    featureFlags: number;
  };
  qmkSettings?: number[];
  /** Enables the Theis194 layer-names extension with these initial names. */
  layerNames?: string[] | null;
  unlocked?: boolean;
  /** Keys to hold for an unlock; defaults to matrix 0,0 and 0,1. Empty = VIAL_INSECURE. */
  unlockKeys?: { row: number; col: number }[];
}

/**
 * Lets a feature's tests teach the simulator extra commands. Return true when
 * the handler answered the report (it edits `msg` in place, as firmware does).
 */
export type SimulatorHandler = (msg: Uint8Array, sim: SimulatedKeyboard) => boolean;

export class SimulatedKeyboard implements Transport {
  readonly info: DeviceInfo;
  readonly requests: Uint8Array[] = [];
  viaProtocol: number;
  vialProtocol: number;
  uid: bigint;
  layoutOptions: number;
  unlocked: boolean;
  layerNames: string[] | null;
  /** Set to make the next n requests go unanswered (timeout). */
  dropNext = 0;
  /** Matrix positions currently "held down", as "row,col". Drives unlock polls and the matrix tester. */
  readonly pressed = new Set<string>();
  unlockInProgress = false;
  unlockCounter = 0;
  readonly handlers: SimulatorHandler[] = [];

  private readonly opts: SimulatedKeyboardOptions;
  private readonly keymap: Uint8Array;
  private readonly encoders: number[];
  private open_ = false;
  private readonly disconnectListeners = new Set<() => void>();

  constructor(opts: SimulatedKeyboardOptions) {
    this.opts = opts;
    this.info = opts.info ?? { productName: "Simulated keyboard", vendorId: 0xfeed, productId: 0x0001 };
    this.viaProtocol = opts.viaProtocol ?? 9;
    this.vialProtocol = opts.vialProtocol ?? 6;
    this.uid = opts.uid ?? 0x1122334455667788n;
    this.layoutOptions = opts.layoutOptions ?? 0;
    this.unlocked = opts.unlocked ?? false;
    this.layerNames = opts.layerNames ? [...opts.layerNames] : null;
    this.keymap = new Uint8Array(opts.layers * opts.rows * opts.cols * 2);
    opts.keymap?.forEach((layer, l) =>
      layer.forEach((row, r) => row.forEach((code, c) => this.setKeycode(l, r, c, code))),
    );
    const encoderCount = opts.encoderCount ?? 0;
    this.encoders = new Array(opts.layers * encoderCount * 2).fill(0);
    opts.encoders?.forEach((layer, l) =>
      layer.forEach(([ccw, cw], e) => {
        this.encoders[(l * encoderCount + e) * 2] = ccw;
        this.encoders[(l * encoderCount + e) * 2 + 1] = cw;
      }),
    );
  }

  async open(): Promise<void> {
    this.open_ = true;
  }

  async close(): Promise<void> {
    this.open_ = false;
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  unplug(): void {
    this.open_ = false;
    for (const cb of this.disconnectListeners) cb();
  }

  getKeycode(layer: number, row: number, col: number): number {
    return u16be(this.keymap, this.keyOffset(layer, row, col));
  }

  getEncoder(layer: number, index: number, direction: 0 | 1): number {
    return this.encoders[(layer * (this.opts.encoderCount ?? 0) + index) * 2 + direction];
  }

  async send(report: Uint8Array): Promise<Uint8Array> {
    if (!this.open_) throw new DeviceDisconnectedError();
    if (report.length !== MSG_LEN) throw new Error(`reports must be ${MSG_LEN} bytes`);
    this.requests.push(report.slice());
    if (this.dropNext > 0) {
      this.dropNext--;
      throw new TransportTimeoutError();
    }
    const msg = report.slice();
    this.handle(msg);
    return msg;
  }

  private keyOffset(layer: number, row: number, col: number): number {
    const { rows, cols } = this.opts;
    return (layer * rows * cols + row * cols + col) * 2;
  }

  private setKeycode(layer: number, row: number, col: number, code: number): void {
    const off = this.keyOffset(layer, row, col);
    this.keymap[off] = (code >> 8) & 0xff;
    this.keymap[off + 1] = code & 0xff;
  }

  get unlockKeys(): { row: number; col: number }[] {
    return (
      this.opts.unlockKeys ?? [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ]
    );
  }

  /** Simulates holding (or releasing) every unlock key. */
  holdUnlockKeys(held = true): void {
    for (const k of this.unlockKeys) {
      if (held) this.pressed.add(`${k.row},${k.col}`);
      else this.pressed.delete(`${k.row},${k.col}`);
    }
  }

  private handle(msg: Uint8Array): void {
    const { layers, rows, cols } = this.opts;
    for (const handler of this.handlers) if (handler(msg, this)) return;
    switch (msg[0]) {
      case C.CMD_VIA_GET_PROTOCOL_VERSION:
        msg.set(be16(this.viaProtocol), 1);
        return;
      case C.CMD_VIA_GET_KEYBOARD_VALUE:
        if (msg[1] === C.VIA_LAYOUT_OPTIONS) msg.set(be32(this.layoutOptions), 2);
        else if (msg[1] === C.VIA_SWITCH_MATRIX_STATE && this.unlocked) this.writeMatrixState(msg);
        else msg[0] = 0xff;
        return;
      case C.CMD_VIA_SET_KEYBOARD_VALUE:
        if (msg[1] === C.VIA_LAYOUT_OPTIONS) this.layoutOptions = u32be(msg, 2);
        else msg[0] = 0xff;
        return;
      case C.CMD_VIA_GET_KEYCODE:
        msg.set(be16(this.getKeycode(msg[1], msg[2], msg[3])), 4);
        return;
      case C.CMD_VIA_SET_KEYCODE:
        if (msg[1] < layers && msg[2] < rows && msg[3] < cols)
          this.setKeycode(msg[1], msg[2], msg[3], u16be(msg, 4));
        return;
      case C.CMD_VIA_MACRO_GET_COUNT:
        msg[1] = this.opts.macroCount ?? 0;
        return;
      case C.CMD_VIA_MACRO_GET_BUFFER_SIZE:
        msg.set(be16(this.opts.macroBufferSize ?? 0), 1);
        return;
      case C.CMD_VIA_GET_LAYER_COUNT:
        msg[1] = layers;
        return;
      case C.CMD_VIA_KEYMAP_GET_BUFFER: {
        const offset = u16be(msg, 1);
        const size = Math.min(msg[3], 28);
        for (let i = 0; i < size; i++) msg[4 + i] = this.keymap[offset + i] ?? 0;
        return;
      }
      case C.CMD_VIA_VIAL_PREFIX:
        this.handleVial(msg);
        return;
      default:
        msg[0] = 0xff; // id_unhandled
    }
  }

  private handleVial(msg: Uint8Array): void {
    const def = this.opts.compressedDefinition;
    const encoderCount = this.opts.encoderCount ?? 0;
    switch (msg[1]) {
      case C.CMD_VIAL_GET_KEYBOARD_ID: {
        msg.fill(0);
        msg.set(le32(this.vialProtocol), 0);
        const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
        view.setBigUint64(4, this.uid, true);
        return;
      }
      case C.CMD_VIAL_GET_SIZE:
        msg.fill(0);
        msg.set(le32(def.length), 0);
        return;
      case C.CMD_VIAL_GET_DEFINITION: {
        const page = u32le(msg, 2);
        msg.fill(0);
        msg.set(def.subarray(page * MSG_LEN, page * MSG_LEN + MSG_LEN), 0);
        return;
      }
      case C.CMD_VIAL_GET_ENCODER: {
        const layer = msg[2];
        const idx = msg[3];
        msg.fill(0);
        if (idx < encoderCount) {
          msg.set(be16(this.getEncoder(layer, idx, 0)), 0);
          msg.set(be16(this.getEncoder(layer, idx, 1)), 2);
        }
        return;
      }
      case C.CMD_VIAL_SET_ENCODER: {
        const [layer, idx, dir] = [msg[2], msg[3], msg[4]];
        if (idx < encoderCount && dir < 2)
          this.encoders[(layer * encoderCount + idx) * 2 + dir] = u16be(msg, 5);
        return;
      }
      case C.CMD_VIAL_GET_UNLOCK_STATUS:
        msg.fill(0xff);
        msg[0] = this.unlocked ? 1 : 0;
        msg[1] = this.unlockInProgress ? 1 : 0;
        this.unlockKeys.forEach((k, i) => msg.set([k.row, k.col], 2 + i * 2));
        return;
      case C.CMD_VIAL_UNLOCK_START:
        this.unlockInProgress = true;
        this.unlockCounter = UNLOCK_COUNTER_MAX;
        return;
      case C.CMD_VIAL_UNLOCK_POLL: {
        // vial.c decrements once per poll more than 100 ms apart while every key is held;
        // the simulator takes bigger steps so tests run fast.
        if (this.unlockInProgress) {
          const holding = this.unlockKeys.every((k) => this.pressed.has(`${k.row},${k.col}`));
          if (holding) {
            this.unlockCounter = Math.max(0, this.unlockCounter - 10);
            if (this.unlockCounter === 0) {
              this.unlockInProgress = false;
              this.unlocked = true;
            }
          } else {
            this.unlockCounter = UNLOCK_COUNTER_MAX;
          }
        }
        msg[0] = this.unlocked ? 1 : 0;
        msg[1] = this.unlockInProgress ? 1 : 0;
        msg[2] = this.unlockCounter;
        return;
      }
      case C.CMD_VIAL_LOCK:
        this.unlocked = false;
        return;
      case C.CMD_VIAL_QMK_SETTINGS_QUERY: {
        const cur = u16le(msg, 2);
        const ids = (this.opts.qmkSettings ?? []).filter((q) => q > cur).sort((a, b) => a - b);
        msg.fill(0xff);
        for (let i = 0; i < 16 && i < ids.length; i++) msg.set([ids[i] & 0xff, ids[i] >> 8], i * 2);
        return;
      }
      case C.CMD_VIAL_DYNAMIC_ENTRY_OP:
        this.handleDynamic(msg);
        return;
      default:
      // vial.c leaves unknown sub-commands' replies untouched.
    }
  }

  private writeMatrixState(msg: Uint8Array): void {
    const { rows, cols } = this.opts;
    if ((Math.floor(cols / 8) + 1) * rows > 28) return; // via.c sends nothing for large matrices
    const rowSize = Math.ceil(cols / 8);
    msg.fill(0, 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!this.pressed.has(`${row},${col}`)) continue;
        msg[2 + row * rowSize + rowSize - 1 - Math.floor(col / 8)] |= 1 << (col % 8);
      }
    }
  }

  private handleDynamic(msg: Uint8Array): void {
    if (this.vialProtocol < C.VIAL_PROTOCOL_DYNAMIC) return;
    switch (msg[2]) {
      case C.DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES: {
        const d = this.opts.dynamic ?? {
          tapDance: 0,
          combo: 0,
          keyOverride: 0,
          altRepeatKey: 0,
          featureFlags: 0,
        };
        msg.fill(0);
        msg.set([d.tapDance, d.combo, d.keyOverride, d.altRepeatKey], 0);
        msg[MSG_LEN - 1] = d.featureFlags;
        return;
      }
      case C.DYNAMIC_VIAL_LAYER_NAME_GET: {
        if (!this.layerNames) return;
        const layer = msg[3];
        msg.fill(0);
        if (layer >= this.opts.layers) {
          msg[0] = 1;
          return;
        }
        const name = new TextEncoder().encode(this.layerNames[layer] ?? "").slice(0, C.LAYER_NAME_LEN);
        msg.set(name, 1);
        return;
      }
      case C.DYNAMIC_VIAL_LAYER_NAME_SET: {
        if (!this.layerNames) return;
        const layer = msg[3];
        const raw = msg.slice(4, 4 + C.LAYER_NAME_LEN);
        msg.fill(0);
        // Assumed to need an unlocked board, as the fork's GUI always unlocks first.
        if (layer >= this.opts.layers || !this.unlocked) {
          msg[0] = 1;
          return;
        }
        const end = raw.indexOf(0);
        this.layerNames[layer] = new TextDecoder().decode(end === -1 ? raw : raw.slice(0, end));
        return;
      }
      default:
      // Not implemented in vial.c either (no default case): reply untouched.
    }
  }
}
