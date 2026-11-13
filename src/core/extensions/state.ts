// SPDX-License-Identifier: GPL-2.0-or-later
// ctx.state: state an extension keeps, which ViaLink saves, loads and
// re-renders (plan doc, Extension API, "Extension state"). ViaLink-only.
//
// - persist "layout" (the default): belongs to the layout. Changes are
//   undoable. Kept in memory per keyboard for now; migration step 8 saves it
//   in .vialink files under extensions.<id>.
// - persist "browser": a private room in this browser (the app hands in
//   localStorage), never in save files.
// An extension reads and writes only its own state: names are scoped by its id.

import type { History } from "../history.ts";

export interface StateOptions<T> {
  default: T;
  /**
   * Where this state is kept.
   * - "layout" (default): saved in .vialink files, so it moves with them to other computers,
   *   comes back from backups, and changes are undoable.
   * - "browser": a private room in this browser for anything you like. Not in save files and
   *   not moved to other computers; lost when site data is cleared.
   * If you are unsure, use "layout".
   */
  persist?: "layout" | "browser";
  /** Bump when the shape changes; `upgrade` turns older saved values into the new shape. */
  version?: number;
  upgrade?(old: unknown, fromVersion: number): T;
}

export interface StateHandle<T> {
  get(): T;
  /** Replaces the value; "layout" state records the change for undo. */
  set(value: T): void;
}

/** Key-value storage for "browser" state (localStorage in the app). */
export interface BrowserStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** A Map, for tests and Node. */
export function memoryStorage(): BrowserStorage {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

/** A saved value with the version of its shape. */
export interface Versioned {
  v: number;
  value: unknown;
}

/** The value to use for a saved entry: upgraded when older, the default when missing, newer or unreadable. */
function restore<T>(saved: Versioned | undefined, options: StateOptions<T>): T {
  const version = options.version ?? 1;
  if (!saved || typeof saved.v !== "number" || saved.v > version) return options.default;
  if (saved.v === version) return saved.value as T;
  return options.upgrade ? options.upgrade(saved.value, saved.v) : options.default;
}

export const BROWSER_STATE_PREFIX = "vialink.ext.";

/** All state of the extensions on one keyboard. */
export class ExtensionStates {
  /** Layout state by extension id, then name; step 8 saves this. */
  private readonly layout = new Map<string, Map<string, Versioned>>();
  private readonly handles = new Map<string, StateHandle<unknown>>();

  constructor(
    private readonly storage: BrowserStorage,
    private readonly history: History,
    private readonly changed: () => void,
    /** Throws when `owner` may not write right now (during its before/filter hook handlers). */
    private readonly guard: (owner: { id: string; name: string }, name: string) => void = () => undefined,
  ) {}

  /** The handle for `owner`'s state `name`; the same handle on every call (options from the first). */
  state<T>(owner: { id: string; name: string }, name: string, options: StateOptions<T>): StateHandle<T> {
    const key = `${owner.id}\u0000${name}`;
    const known = this.handles.get(key);
    if (known) return known as StateHandle<T>;
    const inner =
      options.persist === "browser"
        ? this.browser(owner.id, name, options)
        : this.layoutState(owner, name, options);
    const handle: StateHandle<T> = {
      get: () => inner.get(),
      set: (value) => {
        this.guard(owner, name);
        inner.set(value);
      },
    };
    this.handles.set(key, handle as StateHandle<unknown>);
    return handle;
  }

  /** Layout state of every extension, as saved values; for the .vialink file (step 8). */
  layoutSnapshot(): Record<string, Record<string, Versioned>> {
    const out: Record<string, Record<string, Versioned>> = {};
    for (const [id, states] of this.layout) out[id] = Object.fromEntries(states);
    return out;
  }

  private browser<T>(id: string, name: string, options: StateOptions<T>): StateHandle<T> {
    const key = `${BROWSER_STATE_PREFIX}${id}.${name}`;
    let saved: Versioned | undefined;
    try {
      saved = JSON.parse(this.storage.get(key) ?? "null") ?? undefined;
    } catch {
      saved = undefined;
    }
    let value = restore(saved, options);
    return {
      get: () => value,
      set: (next) => {
        value = next;
        try {
          this.storage.set(key, JSON.stringify({ v: options.version ?? 1, value: next }));
        } catch {
          // Storage blocked or full: the value lasts for this page only.
        }
        this.changed();
      },
    };
  }

  private layoutState<T>(
    owner: { id: string; name: string },
    name: string,
    options: StateOptions<T>,
  ): StateHandle<T> {
    let states = this.layout.get(owner.id);
    if (!states) this.layout.set(owner.id, (states = new Map()));
    const version = options.version ?? 1;
    const write = (value: T) => {
      states.set(name, { v: version, value });
      this.changed();
    };
    let value = restore(states.get(name), options);
    states.set(name, { v: version, value });
    return {
      get: () => value,
      set: (next) => {
        const old = value;
        if (Object.is(old, next)) return;
        value = next;
        write(next);
        this.history.record({
          label: `${owner.name}: change ${name}`,
          undo: async () => {
            value = old;
            write(old);
          },
          redo: async () => {
            value = next;
            write(next);
          },
          isCurrent: () => Object.is(value, next),
        });
      },
    };
  }
}
