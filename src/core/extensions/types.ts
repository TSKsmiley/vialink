// SPDX-License-Identifier: GPL-2.0-or-later
// Built-in keyboard extensions: optional features that probe the board at
// connect time and, when supported, keep their own state, contribute .vil
// fields and restore steps. The app layer adds UI for them separately
// (src/app/extensions/), so this stays free of React.
//
// Extensions are written in this repository only. Loading third-party code
// needs a security design first: anything in the page has full WebHID access.

import type { Keyboard } from "../keyboard.ts";
import type { HistoryWrite } from "../history.ts";
import type { RequestQueue } from "../transport/queue.ts";

export interface ExtensionContext {
  readonly keyboard: Keyboard;
  readonly queue: RequestQueue;
  /** Tells subscribers of the keyboard that extension state changed. */
  changed(): void;
  /**
   * Records a write the board accepted in the keyboard's undo history. Call it
   * after every write a user can take back, with undo/redo that go through the
   * same write method (so validation, unlock checks and the queue apply).
   */
  record(write: HistoryWrite): void;
}

/** One write a .vil restore will make on behalf of an extension. */
export interface ExtensionRestoreStep {
  /** Shown in the load confirmation, e.g. 'Rename layer 1 to "Nav"'. */
  description: string;
  apply(): Promise<void>;
}

export interface ExtensionVilSupport<State> {
  /** Top-level .vil keys this extension owns. */
  readonly keys: readonly string[];
  /** Fields to write on save, in order. */
  save(state: State): Record<string, unknown>;
  /** Writes needed to make the board match the file; empty when nothing differs. */
  restore(state: State, file: Readonly<Record<string, unknown>>): ExtensionRestoreStep[];
}

/**
 * Hooks into layer operations, so per-layer data an extension keeps follows
 * the keys. Each hook is awaited inside the operation's undo group: writes it
 * records (via ExtensionContext.record) join the same undo step, and an error
 * stops the operation and is shown to the user.
 */
export interface ExtensionLayerHooks<State> {
  /** "Clear layer": reset this extension's data for `layer` (e.g. remove its name). */
  clear?(state: State, layer: number): Promise<void>;
}

export type ExtensionGroup = "standard" | "compatible" | "nonstandard";

export interface KeyboardExtension<State = unknown> {
  /** Stable identifier, used for settings and lookups. */
  readonly id: string;
  /** Human-readable name for the settings list. */
  readonly name: string;
  readonly description: string;
  /**
   * Where the Extensions dialog lists it: "standard" for features of standard
   * Vial firmware (macros, tap dance, …); "compatible" for ViaLink extras that
   * work with standard Vial firmware but desktop Vial lacks; "nonstandard"
   * (the default) for extensions that need firmware beyond standard Vial
   * (e.g. dynamic layer names).
   */
  readonly group?: ExtensionGroup;
  /** Where to get firmware that supports this extension, shown in the settings list. */
  readonly firmware?: { readonly label: string; readonly url: string };
  /**
   * Runs once the keymap is loaded. Returns the extension's state when the
   * board supports it, or null when it does not (the extension is then
   * inactive for this board).
   */
  probe(ctx: ExtensionContext): Promise<State | null>;
  readonly vil?: ExtensionVilSupport<State>;
  readonly layers?: ExtensionLayerHooks<State>;
}

/** An extension that probed successfully on the connected board. */
export interface ActiveExtension<State = unknown> {
  readonly extension: KeyboardExtension<State>;
  readonly state: State;
}
