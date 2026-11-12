// SPDX-License-Identifier: GPL-2.0-or-later
// Built-in keyboard extensions: optional features that probe the board at
// connect time and, when supported, keep their own state, contribute .vil
// fields and restore steps. The app layer adds UI for them separately
// (src/app/extensions/), so this stays free of React.
//
// Extensions are written in this repository only. Loading third-party code
// needs a security design first: anything in the page has full WebHID access.

import type { Keyboard } from "../keyboard.ts";
import type { RequestQueue } from "../transport/queue.ts";

export interface ExtensionContext {
  readonly keyboard: Keyboard;
  readonly queue: RequestQueue;
  /** Tells subscribers of the keyboard that extension state changed. */
  changed(): void;
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

export interface KeyboardExtension<State = unknown> {
  /** Stable identifier, used for settings and lookups. */
  readonly id: string;
  /** Human-readable name for the settings list. */
  readonly name: string;
  readonly description: string;
  /** Where to get firmware that supports this extension, shown in the settings list. */
  readonly firmware?: { readonly label: string; readonly url: string };
  /**
   * Runs once the keymap is loaded. Returns the extension's state when the
   * board supports it, or null when it does not (the extension is then
   * inactive for this board).
   */
  probe(ctx: ExtensionContext): Promise<State | null>;
  readonly vil?: ExtensionVilSupport<State>;
}

/** An extension that probed successfully on the connected board. */
export interface ActiveExtension<State = unknown> {
  readonly extension: KeyboardExtension<State>;
  readonly state: State;
}
