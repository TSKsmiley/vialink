// SPDX-License-Identifier: GPL-2.0-or-later
// Undo and redo for every write ViaLink makes to a keyboard. ViaLink-only:
// vial-gui has no undo, and nothing here touches the wire format or .vil.
//
// One History per connected keyboard (Keyboard.history), in memory only; it
// ends when the keyboard disconnects. Each write method records, after the
// board accepted the write, how to put the old value back and how to write
// the new one again. Both go through the same write methods, so through the
// keyboard's one RequestQueue, with the same unlock checks and validation.
//
// One user action is one entry: wrap multi-write actions in group() (a .vil
// load, a layer paste). Undoing an entry writes the old values newest first.
// If one of those writes fails, the rest stop, the entry stays on the undo
// stack, and the error names the write that failed. Undo writes set absolute
// values, so trying the entry again is safe.

/** One recorded write. */
export interface HistoryWrite {
  /** What was written, e.g. "Layer 1, key (2, 3): KC_A → KC_B"; names the write in errors. */
  readonly label: string;
  /** Writes the value from before the change back to the board. */
  undo(): Promise<void>;
  /** Writes the changed value again. */
  redo(): Promise<void>;
  /**
   * True while the board still holds the value this write left. When false at
   * undo time, something else changed it since, and undo asks before
   * overwriting (History.confirmStale).
   */
  isCurrent?(): boolean;
}

export interface HistoryEntry {
  /** Shown in the Undo button and toast, e.g. "Set layer 0 key (0, 1) to KC_SPACE". */
  readonly label: string;
  readonly writes: readonly HistoryWrite[];
}

export type HistoryEvent =
  | { kind: "recorded"; entry: HistoryEntry }
  | { kind: "undone"; entry: HistoryEntry }
  | { kind: "redone"; entry: HistoryEntry };

export class HistoryError extends Error {
  /** The write that failed. */
  readonly write: HistoryWrite;
  constructor(action: "undo" | "redo", write: HistoryWrite, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`Could not ${action} ${write.label}: ${why}`);
    this.name = "HistoryError";
    this.write = write;
  }
}

export type StaleHandler = (entry: HistoryEntry, action: "undo" | "redo") => Promise<boolean>;

/** How many entries each stack keeps; the oldest drop off. */
export const HISTORY_LIMIT = 200;

interface OpenGroup {
  label: string;
  writes: HistoryWrite[];
}

export class History {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<(e: HistoryEvent | null) => void>();
  private groups: OpenGroup[] = [];
  /** Set while undo or redo writes, so those writes are not recorded again. */
  private replaying = false;
  private running: Promise<unknown> = Promise.resolve();

  private confirmStale: StaleHandler | null = null;

  /**
   * Sets what to ask before undoing an entry whose values were changed since
   * by something else; it resolves true to overwrite. Without a handler, undo
   * overwrites.
   */
  setConfirmStale(handler: StaleHandler | null): void {
    this.confirmStale = handler;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** The entry Undo would revert, or null. */
  get nextUndo(): HistoryEntry | null {
    return this.undoStack.at(-1) ?? null;
  }
  /** The entry Redo would apply, or null. */
  get nextRedo(): HistoryEntry | null {
    return this.redoStack.at(-1) ?? null;
  }
  /** True while undo or redo is writing. */
  get busy(): boolean {
    return this.replaying;
  }

  /** True while an operation writes: a group is open, or undo/redo replays. */
  get writing(): boolean {
    return this.groups.length > 0 || this.replaying;
  }

  /** Called with each change; `null` when only availability changed (e.g. busy). */
  subscribe(listener: (e: HistoryEvent | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Records a write the board accepted. Inside group() it joins the group;
   * otherwise it is an entry on its own, labelled with the write's label.
   * Ignored while undo or redo replays.
   */
  record(write: HistoryWrite): void {
    if (this.replaying) return;
    const group = this.groups.at(-1);
    if (group) {
      group.writes.push(write);
      return;
    }
    this.push({ label: write.label, writes: [write] });
  }

  /**
   * Runs `action` and records every write it makes as one entry. Groups may
   * nest; the outermost one makes the entry. Writes that succeeded before an
   * error are still recorded, so a half-done action can be undone.
   */
  async group<T>(label: string, action: () => Promise<T>): Promise<T> {
    const group: OpenGroup = { label, writes: [] };
    this.groups.push(group);
    if (this.groups.length === 1) this.emit(null);
    try {
      return await action();
    } finally {
      this.groups = this.groups.filter((g) => g !== group);
      if (this.groups.length === 0) this.emit(null);
      if (group.writes.length > 0) {
        const parent = this.groups.at(-1);
        if (parent) parent.writes.push(...group.writes);
        else this.push({ label, writes: group.writes });
      }
    }
  }

  /** Reverts the newest entry. Resolves to the entry, or null when there was nothing to undo or it was declined. */
  undo(): Promise<HistoryEntry | null> {
    return this.serial(() => this.replay("undo"));
  }

  /** Applies the newest undone entry again. */
  redo(): Promise<HistoryEntry | null> {
    return this.serial(() => this.replay("redo"));
  }

  /** Drops everything, e.g. when the keyboard reloads its state from the board. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit(null);
  }

  private push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit({ kind: "recorded", entry });
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.running.then(job);
    this.running = run.catch(() => undefined);
    return run;
  }

  private async replay(action: "undo" | "redo"): Promise<HistoryEntry | null> {
    const from = action === "undo" ? this.undoStack : this.redoStack;
    const to = action === "undo" ? this.redoStack : this.undoStack;
    const entry = from.at(-1);
    if (!entry) return null;

    // Undo expects the board to hold each write's new value. Redo runs right
    // after an undo of the same entry, so the old values are expected; only
    // undo can detect changes from elsewhere with isCurrent().
    if (action === "undo" && entry.writes.some((w) => w.isCurrent && !w.isCurrent())) {
      const ok = this.confirmStale ? await this.confirmStale(entry, action) : true;
      if (!ok) return null;
    }

    this.replaying = true;
    this.emit(null);
    try {
      const writes = action === "undo" ? [...entry.writes].reverse() : entry.writes;
      for (const w of writes) {
        try {
          await (action === "undo" ? w.undo() : w.redo());
        } catch (err) {
          throw new HistoryError(action, w, err);
        }
      }
    } catch (err) {
      this.replaying = false;
      this.emit(null);
      throw err;
    }
    this.replaying = false;
    from.pop();
    to.push(entry);
    this.emit({ kind: action === "undo" ? "undone" : "redone", entry });
    return entry;
  }

  private emit(e: HistoryEvent | null): void {
    for (const l of this.listeners) l(e);
  }
}
