// SPDX-License-Identifier: GPL-2.0-or-later
// One connected Vial keyboard: loads everything Milestone 1 needs and writes
// keymap, encoder and layout-option changes. Follows vial-gui's
// protocol/keyboard_comm.py (reload, set_key, set_encoder, set_layout_options)
// and protocol/dynamic.py for the capability probe.

import {
  decodeDefinition,
  extractPhysicalLayout,
  fetchCompressedDefinition,
  type PhysicalEncoder,
  type PhysicalKey,
  type VialDefinition,
} from "./definition/definition.ts";
import { packLayoutOptions, unpackLayoutOptions, type LayoutLabel } from "./definition/layoutOptions.ts";
import { BUILTIN_EXTENSIONS } from "./extensions/index.ts";
import type { ActiveExtension, ExtensionContext, KeyboardExtension } from "./extensions/types.ts";
import { KeycodeTable, RESET_KEYCODE } from "./keycodes/table.ts";
import {
  viaGetLayerCount,
  viaGetLayoutOptions,
  viaGetProtocolVersion,
  viaKeymapGetBuffer,
  viaMacroGetBufferSize,
  viaMacroGetCount,
  viaSetKeycode,
  viaSetLayoutOptions,
  vialGetDynamicEntryCounts,
  vialGetEncoder,
  vialGetKeyboardId,
  vialGetUnlockStatus,
  vialQmkSettingsQuery,
  vialSetEncoder,
  type DynamicEntryCounts,
} from "./protocol/commands.ts";
import * as C from "./protocol/constants.ts";
import type { RequestQueue } from "./transport/queue.ts";
import { u16be } from "./util/bytes.ts";

export class UnsupportedProtocolError extends Error {
  readonly viaProtocol: number;
  readonly vialProtocol: number;
  constructor(viaProtocol: number, vialProtocol: number, viaOnly: boolean) {
    super(
      viaOnly
        ? `This keyboard does not run Vial firmware (VIA protocol ${viaProtocol}). vial-ts only supports Vial keyboards.`
        : `Unsupported protocol version: VIA ${viaProtocol}, Vial ${vialProtocol}. Update the keyboard's Vial firmware.`,
    );
    this.name = "UnsupportedProtocolError";
    this.viaProtocol = viaProtocol;
    this.vialProtocol = vialProtocol;
  }
}

export class UnlockRequiredError extends Error {
  constructor(what: string) {
    super(`${what} requires the keyboard to be unlocked.`);
    this.name = "UnlockRequiredError";
  }
}

/**
 * Asks the user to unlock the board (the app shows the unlock dialog).
 * Resolves true once unlocked, false if the user cancelled.
 */
export type UnlockHandler = (reason: string) => Promise<boolean>;

/** What the board supports, probed at connect time. */
export interface Capabilities {
  lighting: string;
  /** Vial protocol ≥ 3: unlock-gated matrix tester. */
  matrixTester: boolean;
  /** Dynamic entry counts (Vial protocol ≥ 4), or null on older firmware. */
  dynamic: DynamicEntryCounts | null;
  /** Feature names keycodes can require: caps_word, layer_lock, repeat_key, persistent_default_layer. */
  features: string[];
  /** QMK setting ids (qsids) the board supports; empty below Vial protocol 4. */
  qmkSettings: number[];
}

export type LoadStage =
  | "protocol"
  | "definition"
  | "layers"
  | "macros"
  | "capabilities"
  | "keymap"
  | "encoders"
  | "layout options"
  | "extensions";

export interface LoadOptions {
  onProgress?: (p: LoadProgress) => void;
  /** Extensions to probe; defaults to every built-in one. */
  extensions?: readonly KeyboardExtension<unknown>[];
}

export interface LoadProgress {
  stage: LoadStage;
  done: number;
  total: number;
}

const keyId = (layer: number, row: number, col: number) => `${layer},${row},${col}`;
const encId = (layer: number, index: number, direction: number) => `${layer},${index},${direction}`;

export class Keyboard {
  readonly queue: RequestQueue;
  viaProtocol = -1;
  vialProtocol = -1;
  uid = 0n;
  definition!: VialDefinition;
  rows = 0;
  cols = 0;
  layers = 0;
  keys: PhysicalKey[] = [];
  encoders: PhysicalEncoder[] = [];
  encoderCount = 0;
  layoutLabels: LayoutLabel[] | null = null;
  /** Packed layout options, or -1 when the board declares none. */
  layoutOptions = -1;
  macroCount = 0;
  macroMemory = 0;
  capabilities!: Capabilities;
  keycodes!: KeycodeTable;
  /** Set by the app to show the unlock dialog when an operation needs it. */
  unlockHandler: UnlockHandler | null = null;

  private readonly keymap = new Map<string, number>();
  private readonly encoderMap = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly active = new Map<string, ActiveExtension>();
  private revision = 0;

  private constructor(queue: RequestQueue) {
    this.queue = queue;
  }

  /** Connects and loads the keyboard, mirroring vial-gui's Keyboard.reload(). */
  static async load(queue: RequestQueue, options: LoadOptions = {}): Promise<Keyboard> {
    const kb = new Keyboard(queue);
    await kb.reload(options.onProgress);
    await kb.probeExtensions(options.extensions ?? BUILTIN_EXTENSIONS, options.onProgress);
    return kb;
  }

  /** The state of an extension active on this board, or null when unsupported or disabled. */
  extension<State>(ext: KeyboardExtension<State>): State | null {
    const found = this.active.get(ext.id);
    return found ? (found.state as State) : null;
  }

  /** Every extension active on this board, in probe order. */
  get activeExtensions(): readonly ActiveExtension[] {
    return [...this.active.values()];
  }

  /** Increments on every change; handy as a React dependency. */
  get version(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get name(): string {
    return this.definition?.name ?? this.queue.transport.info.productName;
  }

  /** Matrix positions in the layout, in definition order without duplicates. */
  get matrixPositions(): { row: number; col: number }[] {
    const seen = new Set<string>();
    const out: { row: number; col: number }[] = [];
    for (const k of this.keys) {
      const id = `${k.row},${k.col}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ row: k.row, col: k.col });
      }
    }
    return out;
  }

  get encoderIndices(): number[] {
    return [...new Set(this.encoders.map((e) => e.index))].sort((a, b) => a - b);
  }

  isExampleUid(): boolean {
    return C.isExampleUid(this.uid);
  }

  getKey(layer: number, row: number, col: number): number | undefined {
    return this.keymap.get(keyId(layer, row, col));
  }

  getEncoder(layer: number, index: number, direction: 0 | 1): number | undefined {
    return this.encoderMap.get(encId(layer, index, direction));
  }

  /** Current layout-option choice per label; empty when the board has none. */
  get layoutChoices(): number[] {
    if (!this.layoutLabels || this.layoutOptions === -1) return [];
    return unpackLayoutOptions(this.layoutOptions, this.layoutLabels);
  }

  async setKey(layer: number, row: number, col: number, code: number): Promise<void> {
    const id = keyId(layer, row, col);
    if (!this.keymap.has(id)) throw new Error(`no key at layer ${layer}, row ${row}, col ${col}`);
    if (this.keymap.get(id) === code) return;
    await this.ensureUnlockedFor(code);
    await this.queue.request(viaSetKeycode.encode(layer, row, col, code));
    this.keymap.set(id, code);
    this.changed();
  }

  async setEncoder(layer: number, index: number, direction: 0 | 1, code: number): Promise<void> {
    const id = encId(layer, index, direction);
    if (!this.encoderMap.has(id)) throw new Error(`no encoder ${index} on layer ${layer}`);
    if (this.encoderMap.get(id) === code) return;
    await this.ensureUnlockedFor(code);
    await this.queue.request(vialSetEncoder.encode(layer, index, direction, code));
    this.encoderMap.set(id, code);
    this.changed();
  }

  /** Writes a packed layout-options value (no-op when unchanged or unsupported). */
  async setLayoutOptions(options: number): Promise<void> {
    if (this.layoutOptions === -1 || this.layoutOptions === options) return;
    await this.queue.request(viaSetLayoutOptions.encode(options >>> 0));
    this.layoutOptions = options >>> 0;
    this.changed();
  }

  async setLayoutChoices(choices: number[]): Promise<void> {
    if (!this.layoutLabels) return;
    await this.setLayoutOptions(packLayoutOptions(choices, this.layoutLabels));
  }

  async isUnlocked(): Promise<boolean> {
    if (this.vialProtocol < 0) return true;
    return vialGetUnlockStatus.decode(await this.queue.request(vialGetUnlockStatus.encode())).unlocked;
  }

  /**
   * Makes sure the board is unlocked before an operation that needs it, asking
   * the user through {@link unlockHandler}. Throws UnlockRequiredError when the
   * board stays locked (no handler, or the user cancelled).
   */
  async ensureUnlocked(reason: string): Promise<void> {
    if (await this.isUnlocked()) return;
    if (this.unlockHandler && (await this.unlockHandler(reason))) return;
    throw new UnlockRequiredError(reason);
  }

  /** vial-gui unlocks before writing QK_BOOT (keyboard_comm.py set_key/set_encoder). */
  private async ensureUnlockedFor(code: number): Promise<void> {
    if (code === this.keycodes.resolve(RESET_KEYCODE)) {
      await this.ensureUnlocked("Assigning QK_BOOT (bootloader)");
    }
  }

  private async probeExtensions(
    extensions: readonly KeyboardExtension<unknown>[],
    onProgress?: (p: LoadProgress) => void,
  ): Promise<void> {
    const ctx: ExtensionContext = { keyboard: this, queue: this.queue, changed: () => this.changed() };
    for (let i = 0; i < extensions.length; i++) {
      onProgress?.({ stage: "extensions", done: i, total: extensions.length });
      const ext = extensions[i];
      const state = await ext.probe(ctx);
      if (state !== null) this.active.set(ext.id, { extension: ext, state });
    }
    this.changed();
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  private async reload(onProgress?: (p: LoadProgress) => void): Promise<void> {
    const q = this.queue;
    const progress = (stage: LoadStage, done = 0, total = 1) => onProgress?.({ stage, done, total });

    progress("protocol");
    this.viaProtocol = viaGetProtocolVersion.decode(await q.request(viaGetProtocolVersion.encode()));
    const id = vialGetKeyboardId.decode(await q.request(vialGetKeyboardId.encode()));
    this.vialProtocol = id.vialProtocol;
    this.uid = id.uid;
    // Check before fetching the definition: a VIA-only board answers the Vial
    // commands with filler, which would otherwise fail later as an opaque XZ error.
    if (
      !C.SUPPORTED_VIA_PROTOCOL.includes(this.viaProtocol) ||
      !C.SUPPORTED_VIAL_PROTOCOL.includes(this.vialProtocol)
    ) {
      const viaOnly = !C.SUPPORTED_VIAL_PROTOCOL.includes(this.vialProtocol);
      throw new UnsupportedProtocolError(this.viaProtocol, this.vialProtocol, viaOnly);
    }

    progress("definition");
    const compressed = await fetchCompressedDefinition(q, (done, total) =>
      progress("definition", done, total),
    );
    this.definition = await decodeDefinition(compressed);
    this.rows = this.definition.matrix.rows;
    this.cols = this.definition.matrix.cols;
    const physical = extractPhysicalLayout(this.definition);
    this.keys = physical.keys;
    this.encoders = physical.encoders;
    this.encoderCount = physical.encoderCount;
    this.layoutLabels = this.definition.layouts.labels?.length ? this.definition.layouts.labels : null;

    progress("layers");
    this.layers = viaGetLayerCount.decode(await q.request(viaGetLayerCount.encode()));

    progress("macros");
    this.macroCount = viaMacroGetCount.decode(await q.request(viaMacroGetCount.encode()));
    this.macroMemory = viaMacroGetBufferSize.decode(await q.request(viaMacroGetBufferSize.encode()));

    progress("capabilities");
    this.capabilities = await this.probeCapabilities();

    this.keycodes = new KeycodeTable({
      vialProtocol: this.vialProtocol,
      layers: this.layers,
      macroCount: this.macroCount,
      tapDanceCount: this.capabilities.dynamic?.tapDance ?? 0,
      customKeycodes: this.definition.customKeycodes,
      midi: this.definition.vial?.midi ?? null,
      supportedFeatures: this.capabilities.features,
    });

    await this.reloadKeymap((done, total) => progress("keymap", done, total));

    const indices = this.encoderIndices;
    for (let layer = 0; layer < this.layers; layer++) {
      for (const index of indices) {
        progress("encoders", layer * indices.length + indices.indexOf(index), this.layers * indices.length);
        const [ccw, cw] = vialGetEncoder.decode(await q.request(vialGetEncoder.encode(layer, index)));
        this.encoderMap.set(encId(layer, index, 0), ccw);
        this.encoderMap.set(encId(layer, index, 1), cw);
      }
    }

    progress("layout options");
    this.layoutOptions = this.layoutLabels
      ? viaGetLayoutOptions.decode(await q.request(viaGetLayoutOptions.encode()))
      : -1;
    this.changed();
  }

  private async reloadKeymap(onProgress: (done: number, total: number) => void): Promise<void> {
    const size = this.layers * this.rows * this.cols * 2;
    const buffer = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += C.BUFFER_FETCH_CHUNK) {
      const sz = Math.min(size - offset, C.BUFFER_FETCH_CHUNK);
      const reply = await this.queue.request(viaKeymapGetBuffer.encode(offset, sz));
      buffer.set(reply.slice(4, 4 + sz), offset);
      onProgress(offset + sz, size);
    }
    const positions = this.matrixPositions;
    for (let layer = 0; layer < this.layers; layer++) {
      for (const { row, col } of positions) {
        const offset = layer * this.rows * this.cols * 2 + row * this.cols * 2 + col * 2;
        this.keymap.set(keyId(layer, row, col), u16be(buffer, offset));
      }
    }
  }

  private async probeCapabilities(): Promise<Capabilities> {
    const q = this.queue;
    const features = new Set<string>();
    let dynamic: DynamicEntryCounts | null = null;
    const qmkSettings: number[] = [];

    if (this.vialProtocol >= C.VIAL_PROTOCOL_DYNAMIC) {
      dynamic = vialGetDynamicEntryCounts.decode(await q.request(vialGetDynamicEntryCounts.encode()));
      if (dynamic.featureFlags & (1 << 0)) features.add("caps_word");
      if (dynamic.featureFlags & (1 << 1)) features.add("layer_lock");
      if (this.vialProtocol >= C.VIAL_PROTOCOL_KEY_OVERRIDE) features.add("persistent_default_layer");
      if (dynamic.altRepeatKey) features.add("repeat_key");
    }

    if (this.vialProtocol >= C.VIAL_PROTOCOL_QMK_SETTINGS) {
      // keyboard_comm.py::reload_settings: page through supported qsids until 0xFFFF.
      let cur = 0;
      const seen = new Set<number>();
      while (cur !== 0xffff) {
        const ids = vialQmkSettingsQuery.decode(await q.request(vialQmkSettingsQuery.encode(cur)));
        const before = cur;
        for (const qsid of ids) {
          cur = Math.max(cur, qsid);
          if (qsid !== 0xffff && !seen.has(qsid)) {
            seen.add(qsid);
            qmkSettings.push(qsid);
          }
        }
        if (cur === before) break; // a board that repeats itself would otherwise loop forever
      }
    }

    return {
      lighting: this.definition.lighting ?? "none",
      matrixTester: this.vialProtocol >= C.VIAL_PROTOCOL_MATRIX_TESTER,
      dynamic,
      features: [...features],
      qmkSettings: qmkSettings.sort((a, b) => a - b),
    };
  }
}
