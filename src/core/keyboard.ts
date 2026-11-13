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
import { dependencyOrder, resolveActive, type ExtensionStatus } from "./extensions/manifest.ts";
import { History } from "./history.ts";
import {
  ExtensionCommandError,
  type ActiveExtension,
  type BoardView,
  type DeviceContext,
  type HostContext,
  type KeyboardExtension,
} from "./extensions/types.ts";
import { isStandardCommand, startsWith } from "./protocol/standard.ts";
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
  vialLock,
  matrixStateFits,
  viaGetMatrixState,
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
        ? `This keyboard does not run Vial firmware (VIA protocol ${viaProtocol}). ViaLink only supports Vial keyboards.`
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
  /**
   * When an extension was last turned on by hand (higher is more recent, 0 when
   * never). Of two conflicting extensions the board supports, the more recent runs.
   */
  recency?: (id: string) => number;
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
  /** Set by the app to show an extension's notices and errors (ctx.notify). */
  notifyHandler: ((kind: "info" | "error", message: string) => void) | null = null;
  /** Set by the app to show the unlock dialog when an operation needs it. */
  unlockHandler: UnlockHandler | null = null;
  /** Last known lock state; null until first checked. Updated by every status check, unlock and lock. */
  unlocked: boolean | null = null;
  /** Undo/redo of every write made through this object; ends with it (on disconnect). */
  readonly history = new History();

  private readonly keymap = new Map<string, number>();
  private readonly encoderMap = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly active = new Map<string, ActiveExtension>();
  /** Switched-on extensions, in dependency order. */
  private enabledList: KeyboardExtension<unknown>[] = [];
  /** What the probes said, by extension id; cleared for an extension when it is turned off. */
  private readonly supported = new Map<string, boolean>();
  private statuses = new Map<string, ExtensionStatus>();
  /** When an extension was last turned on by hand (0: never); settles conflicts. */
  private readonly recency: (id: string) => number;
  private revision = 0;

  private constructor(queue: RequestQueue, recency: (id: string) => number = () => 0) {
    this.queue = queue;
    this.recency = recency;
  }

  /** Connects and loads the keyboard, mirroring vial-gui's Keyboard.reload(). */
  static async load(queue: RequestQueue, options: LoadOptions = {}): Promise<Keyboard> {
    const kb = new Keyboard(queue, options.recency);
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
    const old = this.keymap.get(id)!;
    await this.ensureUnlockedFor(code);
    await this.queue.request(viaSetKeycode.encode(layer, row, col, code));
    this.keymap.set(id, code);
    this.history.record({
      label: `Layer ${layer}, key (${row}, ${col}): ${this.codeName(old)} → ${this.codeName(code)}`,
      undo: () => this.setKey(layer, row, col, old),
      redo: () => this.setKey(layer, row, col, code),
      isCurrent: () => this.keymap.get(id) === code,
    });
    this.changed();
  }

  async setEncoder(layer: number, index: number, direction: 0 | 1, code: number): Promise<void> {
    const id = encId(layer, index, direction);
    if (!this.encoderMap.has(id)) throw new Error(`no encoder ${index} on layer ${layer}`);
    if (this.encoderMap.get(id) === code) return;
    const old = this.encoderMap.get(id)!;
    await this.ensureUnlockedFor(code);
    await this.queue.request(vialSetEncoder.encode(layer, index, direction, code));
    this.encoderMap.set(id, code);
    const turn = direction === 0 ? "clockwise" : "counter-clockwise";
    this.history.record({
      label: `Layer ${layer}, encoder ${index} ${turn}: ${this.codeName(old)} → ${this.codeName(code)}`,
      undo: () => this.setEncoder(layer, index, direction, old),
      redo: () => this.setEncoder(layer, index, direction, code),
      isCurrent: () => this.encoderMap.get(id) === code,
    });
    this.changed();
  }

  /** Writes a packed layout-options value (no-op when unchanged or unsupported). */
  async setLayoutOptions(options: number): Promise<void> {
    if (this.layoutOptions === -1 || this.layoutOptions === options) return;
    const old = this.layoutOptions;
    const value = options >>> 0;
    await this.queue.request(viaSetLayoutOptions.encode(value));
    this.layoutOptions = value;
    this.history.record({
      label: "Layout options",
      undo: () => this.setLayoutOptions(old),
      redo: () => this.setLayoutOptions(value),
      isCurrent: () => this.layoutOptions === value,
    });
    this.changed();
  }

  async setLayoutChoices(choices: number[]): Promise<void> {
    if (!this.layoutLabels) return;
    await this.setLayoutOptions(packLayoutOptions(choices, this.layoutLabels));
  }

  /** A keycode as vial-gui writes it (KC_A, LT(1,KC_SPACE)), for history labels. */
  codeName(code: number): string {
    try {
      return this.keycodes.serialize(code);
    } catch {
      return `0x${code.toString(16).padStart(4, "0")}`;
    }
  }

  async isUnlocked(): Promise<boolean> {
    if (this.vialProtocol < 0) return true;
    const status = vialGetUnlockStatus.decode(await this.queue.request(vialGetUnlockStatus.encode()));
    this.setUnlocked(status.unlocked);
    return status.unlocked;
  }

  /** Full unlock status, including whether an unlock was started and never finished. */
  async unlockStatus() {
    const status = vialGetUnlockStatus.decode(await this.queue.request(vialGetUnlockStatus.encode()));
    this.setUnlocked(status.unlocked);
    return status;
  }

  /** Locks the board again (the Security → Lock action of vial-gui). */
  async lock(): Promise<void> {
    if (this.vialProtocol < 0) return;
    await this.queue.request(vialLock.encode());
    await this.isUnlocked();
  }

  /** Records a lock state learned elsewhere (e.g. by the unlock flow). */
  setUnlocked(unlocked: boolean): void {
    if (this.unlocked === unlocked) return;
    this.unlocked = unlocked;
    this.changed();
  }

  /**
   * The matrix tester needs Vial protocol 3+ and a matrix whose state fits one
   * reply; vial-gui's matrix_test.py disables it otherwise, and so does via.c.
   */
  get matrixTesterSupported(): boolean {
    return this.vialProtocol >= C.VIAL_PROTOCOL_MATRIX_TESTER && matrixStateFits(this.rows, this.cols);
  }

  /** Pressed state per [row][col], or null when the board is locked (it refuses to answer). */
  async pollMatrix(): Promise<boolean[][] | null> {
    const reply = await this.queue.request(viaGetMatrixState.encode(), { retries: 3 });
    return viaGetMatrixState.decode(reply, this.rows, this.cols);
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

  /**
   * Turns an extension on or off for the connected board without reconnecting:
   * off drops its state, on probes the board for it. Resolves whether the
   * extension is active afterwards (on can still be false: the board lacks it,
   * a requirement doesn't run, or a conflicting extension wins).
   */
  async setExtensionEnabled(ext: KeyboardExtension<unknown>, enabled: boolean): Promise<boolean> {
    await this.setExtensionsEnabled([{ extension: ext, enabled }]);
    return this.active.has(ext.id);
  }

  /**
   * Applies several switches at once (the Extensions dialog turns a requirement
   * on together with the extension that needs it), then works out again what
   * runs: requirements first, conflicts by {@link LoadOptions.recency}.
   */
  async setExtensionsEnabled(
    changes: readonly { extension: KeyboardExtension<unknown>; enabled: boolean }[],
  ): Promise<void> {
    let list = [...this.enabledList];
    for (const { extension, enabled } of changes) {
      list = list.filter((e) => e.id !== extension.id);
      if (enabled) list.push(extension);
      else {
        // Turning it on again probes afresh.
        this.supported.delete(extension.id);
        this.active.delete(extension.id);
      }
    }
    const order = BUILTIN_EXTENSIONS.map((e) => e.id);
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    list.sort((a, b) => rank(a.id) - rank(b.id));
    this.enabledList = dependencyOrder(list);
    await this.refreshExtensions();
  }

  /** Why an extension does or does not run on this board. */
  extensionStatus(id: string): ExtensionStatus {
    return this.statuses.get(id) ?? { kind: "off" };
  }

  /**
   * Whether the board supports an extension, probing it when not known yet,
   * without turning it on. Requirements are not checked.
   */
  async supportsExtension(ext: KeyboardExtension<unknown>): Promise<boolean> {
    const known = this.supported.get(ext.id);
    if (known !== undefined) return known;
    const ok = (await ext.probe(this.extensionContext(ext))) !== null;
    this.supported.set(ext.id, ok);
    return ok;
  }

  private async probeExtensions(
    extensions: readonly KeyboardExtension<unknown>[],
    onProgress?: (p: LoadProgress) => void,
  ): Promise<void> {
    this.enabledList = dependencyOrder(extensions);
    await this.refreshExtensions(onProgress);
  }

  /**
   * Probes enabled extensions not probed yet, in dependency order (skipping
   * those whose requirements the board lacks), then decides which run.
   * Running extensions keep their state; newly running ones get a fresh probe.
   */
  private async refreshExtensions(onProgress?: (p: LoadProgress) => void): Promise<void> {
    const ordered = this.enabledList;
    const fresh = new Map<string, unknown>();
    const candidates = new Set<string>();
    for (let i = 0; i < ordered.length; i++) {
      onProgress?.({ stage: "extensions", done: i, total: ordered.length });
      const ext = ordered[i];
      if (!(ext.requires ?? []).every((id) => candidates.has(id))) continue;
      if (!this.supported.has(ext.id)) {
        const state = await ext.probe(this.extensionContext(ext));
        this.supported.set(ext.id, state !== null);
        if (state !== null) fresh.set(ext.id, state);
      }
      if (this.supported.get(ext.id)) candidates.add(ext.id);
    }

    const statuses = resolveActive(ordered, (id) => this.supported.get(id) === true, this.recency);
    const next = new Map<string, ActiveExtension>();
    for (const ext of ordered) {
      if (statuses.get(ext.id)?.kind !== "active") continue;
      const needs = (ext.requires ?? []).filter((id) => !next.has(id));
      if (needs.length > 0) {
        statuses.set(ext.id, { kind: "needs", ids: needs });
        continue;
      }
      const kept = this.active.get(ext.id);
      const state = kept
        ? kept.state
        : fresh.has(ext.id)
          ? fresh.get(ext.id)
          : await ext.probe(this.extensionContext(ext));
      if (state === null) {
        this.supported.set(ext.id, false);
        statuses.set(ext.id, { kind: "unsupported" });
        continue;
      }
      next.set(ext.id, { extension: ext, state });
    }
    this.active.clear();
    for (const [id, entry] of next) this.active.set(id, entry);
    this.statuses = statuses;
    this.changed();
  }

  /**
   * The context one extension gets: everything through it, device access
   * limited by its group (none for "compatible"; standard Vial commands, plus
   * declared custom commands for "nonstandard").
   */
  private extensionContext(ext: KeyboardExtension<unknown>): DeviceContext {
    const host: HostContext = {
      board: this.boardView,
      keymap: {
        get: (layer, row, col) => this.getKey(layer, row, col),
        set: (layer, row, col, code) => this.setKey(layer, row, col, code),
        getEncoder: (layer, index, direction) => this.getEncoder(layer, index, direction),
        setEncoder: (layer, index, direction, code) => this.setEncoder(layer, index, direction, code),
      },
      history: {
        record: (write) => this.history.record(write),
        group: (label, action) => this.history.group(label, action),
      },
      notify: {
        info: (message) => this.notifyHandler?.("info", `${ext.name}: ${message}`),
        error: (message) => this.notifyHandler?.("error", `${ext.name}: ${message}`),
      },
      changed: () => this.changed(),
    };
    // A compatible extension's probe is typed without `device`; leaving it out
    // at run time too keeps a cast from getting around that.
    if (ext.group === "compatible") return host as DeviceContext;
    const custom = ext.group === "nonstandard" ? ext.commands : [];
    return {
      ...host,
      device: {
        request: (data, options) => {
          if (!isStandardCommand(data) && !custom.some((c) => startsWith(data, c.bytes))) {
            const head = [...data.slice(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
            return Promise.reject(
              new ExtensionCommandError(
                `${ext.name} tried to send a command it hasn't declared (${head} …); nothing was sent.`,
              ),
            );
          }
          return this.queue.request(data, options);
        },
        ensureUnlocked: (reason) => this.ensureUnlocked(reason),
      },
    };
  }

  /** The read-only view extensions get; getters, so it stays current. */
  private readonly boardView: BoardView = (() => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const kb = this;
    return Object.freeze({
      get viaProtocol() {
        return kb.viaProtocol;
      },
      get vialProtocol() {
        return kb.vialProtocol;
      },
      get uid() {
        return kb.uid;
      },
      get rows() {
        return kb.rows;
      },
      get cols() {
        return kb.cols;
      },
      get layers() {
        return kb.layers;
      },
      get encoderCount() {
        return kb.encoderCount;
      },
      get keys() {
        return kb.keys;
      },
      get encoders() {
        return kb.encoders;
      },
      get layoutLabels() {
        return kb.layoutLabels;
      },
      get layoutOptions() {
        return kb.layoutOptions;
      },
      get macroCount() {
        return kb.macroCount;
      },
      get macroMemory() {
        return kb.macroMemory;
      },
      get capabilities() {
        return kb.capabilities;
      },
      get keycodes() {
        return kb.keycodes;
      },
      codeName: (code: number) => kb.codeName(code),
    });
  })();

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
