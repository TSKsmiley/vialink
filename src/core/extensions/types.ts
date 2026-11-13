// SPDX-License-Identifier: GPL-2.0-or-later
// Built-in keyboard extensions: optional features that probe the board at
// connect time and, when supported, keep their own state, contribute .vil
// fields and restore steps. The app layer adds UI for them separately
// (src/app/extensions/), so this stays free of React.
//
// Each extension talks to ViaLink only through its context (HostContext or
// DeviceContext), one per extension: a read-only board view, keymap access,
// undo history, notices, and device access limited by its group.
//
// Extensions are written in this repository only. Loading third-party code
// needs a security design first: anything in the page has full WebHID access.

import type { PhysicalEncoder, PhysicalKey } from "../definition/definition.ts";
import type { LayoutLabel } from "../definition/layoutOptions.ts";
import type { HistoryWrite } from "../history.ts";
import type { KeycodeTable } from "../keycodes/table.ts";
import type { Capabilities } from "../keyboard.ts";
import type { TaskHandle, TaskOptions } from "../scheduler.ts";
import type { HookHandler } from "./hooks.ts";
import type { Service } from "./services.ts";
import type { StateHandle, StateOptions } from "./state.ts";
import type { RequestOptions } from "../transport/queue.ts";
import type { ExtensionPoint } from "./manifest.ts";

/**
 * What an extension sees of the keyboard: facts only, no writes. The values
 * are live (a layout option change shows up here).
 */
export interface BoardView {
  readonly viaProtocol: number;
  readonly vialProtocol: number;
  readonly uid: bigint;
  readonly rows: number;
  readonly cols: number;
  readonly layers: number;
  readonly encoderCount: number;
  readonly keys: readonly PhysicalKey[];
  readonly encoders: readonly PhysicalEncoder[];
  readonly layoutLabels: readonly LayoutLabel[] | null;
  /** Packed layout options, or -1 when the board declares none. */
  readonly layoutOptions: number;
  readonly macroCount: number;
  readonly macroMemory: number;
  readonly capabilities: Capabilities;
  readonly keycodes: KeycodeTable;
  /** A keycode's QMK name, or hex when it has none. */
  codeName(code: number): string;
}

/** Keymap reads and writes; each write is checked, queued and recorded for undo. */
export interface KeymapAccess {
  get(layer: number, row: number, col: number): number | undefined;
  set(layer: number, row: number, col: number, code: number): Promise<void>;
  getEncoder(layer: number, index: number, direction: 0 | 1): number | undefined;
  setEncoder(layer: number, index: number, direction: 0 | 1, code: number): Promise<void>;
}

export interface HistoryAccess {
  /**
   * Records a write the board accepted in the keyboard's undo history. Call it
   * after every write a user can take back, with undo/redo that go through the
   * same write method (so validation, unlock checks and the queue apply).
   */
  record(write: HistoryWrite): void;
  /** Runs `action` as one undo step named `label`. */
  group<T>(label: string, action: () => Promise<T>): Promise<T>;
}

/** Messages for the user, shown as ViaLink's own notices and errors. Say what happened in full. */
export interface NotifyAccess {
  info(message: string): void;
  error(message: string): void;
}

/** Sending commands to the keyboard, limited by the extension's group. */
export interface DeviceAccess {
  /**
   * Sends one request through the keyboard's RequestQueue. Standard Vial
   * commands (core/protocol/standard.ts) and, for a non-standard extension,
   * the custom commands its manifest declares; anything else throws
   * {@link ExtensionCommandError} without reaching the keyboard.
   */
  request(data: Uint8Array, options?: RequestOptions): Promise<Uint8Array>;
  /** Makes sure the board is unlocked, asking the user; throws when it stays locked. */
  ensureUnlocked(reason: string): Promise<void>;
}

/**
 * Background work, through the keyboard's one scheduler (core/scheduler.ts).
 * Never start your own timers: scheduled tasks don't pile up, pause while the
 * tab is hidden or an operation writes, stop when the extension is turned off,
 * and their device requests go behind the user's own.
 */
export interface ScheduleAccess {
  every(ms: number, fn: () => void | Promise<void>, options: TaskOptions): TaskHandle;
  once(ms: number, fn: () => void | Promise<void>, options: TaskOptions): TaskHandle;
  /** Once, when nothing else is running. */
  idle(fn: () => void | Promise<void>, options: TaskOptions): TaskHandle;
}

/** Something an overlay points at, drawn by ViaLink next to a named element (an anchor). */
export interface Overlay {
  /**
   * A stable id ViaLink puts on an element (data-anchor): "keymap.layerRail",
   * "keymap.board", "keymap.keyInspector", "sidebar.<view id>". Never a CSS selector.
   */
  readonly anchor: string;
  readonly title: string;
  readonly body?: string;
}

export interface OverlayHandle {
  close(): void;
}

/** Feedback ViaLink draws for an extension: questions and pointers. */
export interface UiAccess {
  /** Asks the user a yes/no question; resolves true for yes. */
  confirm(message: string): Promise<boolean>;
  /** Shows a popover pointing at an anchor until closed (by the extension or the user). */
  overlay(overlay: Overlay): OverlayHandle;
}

/** The host API of a "compatible" extension: no device access at all. */
export interface HostContext {
  readonly board: BoardView;
  readonly schedule: ScheduleAccess;
  /**
   * This extension's own state, which ViaLink saves, loads and re-renders.
   * `persist: "layout"` (the default) moves with layout files and is undoable;
   * `"browser"` stays in this browser. Plain variables need no API.
   */
  state<T>(name: string, options: StateOptions<T>): StateHandle<T>;
  /**
   * Another extension's service (or a core service's first provider), or null
   * when no running extension provides it. Using another extension's service
   * requires listing that extension in requires or optional.
   */
  use<T>(service: Service<T>): T | null;
  readonly keymap: KeymapAccess;
  readonly history: HistoryAccess;
  readonly notify: NotifyAccess;
  readonly ui: UiAccess;
  /** Tells subscribers of the keyboard that extension state changed. */
  changed(): void;
}

/** The host API of a "standard" or "nonstandard" extension. */
export interface DeviceContext extends HostContext {
  readonly device: DeviceAccess;
}

/** A command a non-standard extension sends beyond standard Vial (named in the HID log). */
export interface CustomCommand {
  /** Shown in the HID log, e.g. "Get layer name". */
  readonly name: string;
  readonly kind: "read" | "write";
  /** The request's leading bytes that identify this command. */
  readonly bytes: readonly number[];
  /** Reads the reply (the command's decode in core/protocol). */
  readonly reply: (data: Uint8Array) => unknown;
  /** HID log text for one request, when it should say more than the name (e.g. which layer). */
  readonly describe?: (request: Uint8Array) => string;
}

export class ExtensionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionCommandError";
  }
}

/** One write a .vil restore will make on behalf of an extension. */
export interface ExtensionRestoreStep {
  /** Shown in the load confirmation, e.g. 'Rename layer 1 to "Nav"'. */
  description: string;
  apply(): Promise<void>;
}

/**
 * An extension's own section of the .vialink file, `extensions.<id>`: its
 * fields next to their data version `v` (and ViaLink adds its ctx.state under
 * "state"). Needs the `saves: "layout-file"` permission.
 */
export interface ExtensionLayoutFile<State> {
  /** Data version of the fields save() writes; bump it when their shape changes. */
  readonly version: number;
  /** The extension's fields, e.g. { names: ["Base", "Nav"] }. Not "v" or "state". */
  save(state: State): Record<string, unknown>;
  /** Writes needed to make the board match a section; `fromVersion` is the section's "v". */
  restore(state: State, data: Readonly<Record<string, unknown>>, fromVersion: number): ExtensionRestoreStep[];
}

export interface ExtensionVilSupport<State> {
  /** Top-level .vil keys this extension owns. */
  readonly keys: readonly string[];
  /** Fields to write on save, in order. */
  save(state: State): Record<string, unknown>;
  /** Writes needed to make the board match the file; empty when nothing differs. */
  restore(state: State, file: Readonly<Record<string, unknown>>): ExtensionRestoreStep[];
}

export type ExtensionGroup = "standard" | "compatible" | "nonstandard";

interface ExtensionBase<State> {
  /** Stable identifier, used for settings and lookups. */
  readonly id: string;
  /** Human-readable name for the settings list. */
  readonly name: string;
  readonly description: string;
  /** Where to get firmware that supports this extension, shown in the settings list. */
  readonly firmware?: { readonly label: string; readonly url: string };
  /** Vial's own .vil fields (standard Vial features only); kept pure for Export to Vial. */
  readonly vil?: ExtensionVilSupport<State>;
  /** Permission to keep data in .vialink layout files (shown in the Extensions dialog). */
  readonly saves?: "layout-file";
  /** The extension's section of the .vialink file; needs `saves: "layout-file"`. */
  readonly layoutFile?: ExtensionLayoutFile<State>;
  /** Handlers for hook points (core's, like layer.clear, or other extensions'); see hooks.ts. */
  readonly hooks?: readonly HookHandler[];
  /**
   * Extensions (by id) that must run on the keyboard for this one to run. They
   * probe first; without them this one stays off and the Extensions dialog
   * says "Needs …". Turning one of them off turns this one off too, after asking.
   */
  readonly requires?: readonly string[];
  /** Extensions this one uses when they run and works without. They probe first. */
  readonly optional?: readonly string[];
  /** Services and hook points this extension offers others; ids start with this extension's id. */
  readonly provides?: readonly ExtensionPoint[];
  /**
   * Extensions that can't run at the same time as this one. Turning this one on
   * while one of them runs asks to turn that one off.
   */
  readonly conflicts?: readonly string[];
}

/** A feature of standard Vial firmware (macros, tap dance, …): Vial's standard commands only. */
export interface StandardExtension<State = unknown> extends ExtensionBase<State> {
  readonly group: "standard";
  readonly commands?: undefined;
  /**
   * Runs once the keymap is loaded. Returns the extension's state when the
   * board supports it, or null when it does not (the extension is then
   * inactive for this board).
   */
  probe(ctx: DeviceContext): Promise<State | null>;
}

/**
 * A ViaLink extra that works with any standard Vial firmware. It has no device
 * access, only the host API, so it works on every Vial keyboard by construction.
 */
export interface CompatibleExtension<State = unknown> extends ExtensionBase<State> {
  readonly group: "compatible";
  readonly commands?: undefined;
  /** As {@link StandardExtension.probe}, without device access. */
  probe(ctx: HostContext): Promise<State | null>;
}

/**
 * Needs firmware beyond standard Vial: standard commands plus the custom ones
 * it declares. Must link its firmware; the probe must confirm the firmware
 * answers its commands.
 */
export interface NonstandardExtension<State = unknown> extends ExtensionBase<State> {
  readonly group: "nonstandard";
  readonly commands: readonly CustomCommand[];
  readonly firmware: { readonly label: string; readonly url: string };
  /** As {@link StandardExtension.probe}. */
  probe(ctx: DeviceContext): Promise<State | null>;
}

/**
 * A built-in extension. Its group (in the Extensions dialog) decides what it
 * may send to the keyboard (plan doc, "Extension groups decide what an
 * extension may send").
 */
export type KeyboardExtension<State = unknown> =
  StandardExtension<State> | CompatibleExtension<State> | NonstandardExtension<State>;

/** An extension that probed successfully on the connected board. */
export interface ActiveExtension<State = unknown> {
  readonly extension: KeyboardExtension<State>;
  readonly state: State;
}
