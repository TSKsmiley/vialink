// SPDX-License-Identifier: GPL-2.0-or-later
// One scheduler per keyboard for background work (plan doc, Extension API,
// "Scheduler: background work"). ViaLink-only: vial-gui uses Qt timers.
//
// - No pile-up: a task doesn't start again until its last run finished; ticks
//   missed meanwhile are skipped and counted as late, not queued.
// - Pauses: while the tab is hidden, while an operation writes (a history
//   group is open) and after a disconnect. Essential tasks (unlock polling,
//   which an operation may be waiting on) keep running through the first two.
// - Cleans up: every task has an owner (an extension id, or "app"/"core");
//   stopOwner() ends them all, e.g. when an extension is turned off.
// - Insight: per task, runs, time spent, device requests, late runs and
//   errors. Nothing shows them yet; a later performance view will.
//
// The timers here are the only repeating timers extensions may rely on (a
// lint rule for extension code comes with migration step 7).

export type PauseReason = "hidden" | "operation" | "disconnected";

export interface TaskOptions {
  /** Shown in stats, e.g. "matrix". */
  name: string;
  /** "live" for work a view shows as it happens (the matrix tester); "background" otherwise. */
  kind?: "live" | "background";
}

export interface InternalTaskOptions extends TaskOptions {
  /** Who started it; stopOwner() ends it. */
  owner: string;
  /** Keeps running while hidden or during an operation (unlock polling). Not for extensions. */
  essential?: boolean;
}

export interface TaskStats {
  readonly name: string;
  readonly owner: string;
  readonly kind: "live" | "background";
  readonly runs: number;
  /** Milliseconds spent in runs, in total. */
  readonly busyMs: number;
  /** Device requests sent while a run of this task was in progress. */
  readonly requests: number;
  /** Ticks skipped because the last run hadn't finished or ran long. */
  readonly late: number;
  readonly errors: number;
  readonly lastError: string | null;
}

export interface TaskHandle {
  stop(): void;
  readonly stats: TaskStats;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Run = () => void | Promise<void>;

interface Task {
  options: InternalTaskOptions;
  fn: Run;
  /** null: once/idle. */
  every: number | null;
  idle: boolean;
  due: number;
  timer: unknown;
  running: boolean;
  stopped: boolean;
  stats: {
    runs: number;
    busyMs: number;
    requests: number;
    late: number;
    errors: number;
    lastError: string | null;
  };
}

/** How long an idle task waits between checks for a quiet moment. */
const IDLE_RETRY_MS = 100;

export class Scheduler {
  private readonly clock: Clock;
  private readonly tasks = new Set<Task>();
  private readonly pauses = new Set<PauseReason>();
  /** True while something other than idle work is busy (e.g. the request queue). */
  private readonly busy: () => boolean;
  /** Called with a task's errors, so they are not lost. */
  onError: ((name: string, error: unknown) => void) | null = null;

  constructor(options: { clock?: Clock; busy?: () => boolean } = {}) {
    this.clock = options.clock ?? realClock;
    this.busy = options.busy ?? (() => false);
  }

  /** Runs `fn` every `ms` milliseconds, the first time after `ms` (0: again as soon as a run ends). */
  every(ms: number, fn: Run, options: InternalTaskOptions): TaskHandle {
    if (!(ms >= 0)) throw new RangeError(`interval must be 0 or more, got ${ms}`);
    return this.add({ fn, every: ms, idle: false, due: this.clock.now() + ms }, options);
  }

  /** Runs `fn` once after `ms` milliseconds. */
  once(ms: number, fn: Run, options: InternalTaskOptions): TaskHandle {
    return this.add({ fn, every: null, idle: false, due: this.clock.now() + Math.max(0, ms) }, options);
  }

  /** Runs `fn` once, when no other task runs and the keyboard isn't busy. */
  idle(fn: Run, options: InternalTaskOptions): TaskHandle {
    return this.add({ fn, every: null, idle: true, due: this.clock.now() }, options);
  }

  pause(reason: PauseReason): void {
    if (this.pauses.has(reason)) return;
    this.pauses.add(reason);
    for (const task of this.tasks) if (this.blocked(task)) this.clear(task);
  }

  resume(reason: PauseReason): void {
    if (!this.pauses.delete(reason)) return;
    const now = this.clock.now();
    for (const task of this.tasks) {
      // Time spent paused doesn't count as late: overdue tasks run once, soon.
      if (task.due < now && !this.blocked(task)) task.due = now;
      this.arm(task);
    }
  }

  get paused(): ReadonlySet<PauseReason> {
    return this.pauses;
  }

  /** Stops every task `owner` started. */
  stopOwner(owner: string): void {
    for (const task of [...this.tasks]) if (task.options.owner === owner) this.stop(task);
  }

  stopAll(): void {
    for (const task of [...this.tasks]) this.stop(task);
  }

  /** Stats of every task still scheduled. */
  stats(): TaskStats[] {
    return [...this.tasks].map((t) => this.statsOf(t));
  }

  /**
   * Counts one device request against `owner`'s running task, if it has one
   * running. Resolves whether the request came from scheduled work (so it goes
   * in the queue's low-priority lane).
   */
  noteRequest(owner: string): boolean {
    for (const task of this.tasks) {
      if (task.running && task.options.owner === owner) {
        task.stats.requests++;
        return true;
      }
    }
    return false;
  }

  private add(spec: Pick<Task, "fn" | "every" | "idle" | "due">, options: InternalTaskOptions): TaskHandle {
    const task: Task = {
      ...spec,
      options: { kind: "background", ...options },
      timer: null,
      running: false,
      stopped: false,
      stats: { runs: 0, busyMs: 0, requests: 0, late: 0, errors: 0, lastError: null },
    };
    this.tasks.add(task);
    this.arm(task);
    const statsOf = () => this.statsOf(task);
    return {
      stop: () => this.stop(task),
      get stats() {
        return statsOf();
      },
    };
  }

  private statsOf(task: Task): TaskStats {
    return {
      name: task.options.name,
      owner: task.options.owner,
      kind: task.options.kind ?? "background",
      ...task.stats,
    };
  }

  private blocked(task: Task): boolean {
    if (this.pauses.has("disconnected")) return true;
    if (task.options.essential) return false;
    return this.pauses.size > 0;
  }

  private arm(task: Task): void {
    if (task.stopped || task.running || task.timer !== null || this.blocked(task)) return;
    const wait = Math.max(0, task.due - this.clock.now());
    task.timer = this.clock.setTimeout(() => {
      task.timer = null;
      void this.tick(task);
    }, wait);
  }

  private clear(task: Task): void {
    if (task.timer !== null) this.clock.clearTimeout(task.timer);
    task.timer = null;
  }

  private stop(task: Task): void {
    task.stopped = true;
    this.clear(task);
    this.tasks.delete(task);
  }

  private async tick(task: Task): Promise<void> {
    if (task.stopped || this.blocked(task)) return;
    if (task.idle && (this.busy() || [...this.tasks].some((t) => t !== task && t.running))) {
      task.due = this.clock.now() + IDLE_RETRY_MS;
      this.arm(task);
      return;
    }
    task.running = true;
    const start = this.clock.now();
    try {
      await task.fn();
    } catch (err) {
      task.stats.errors++;
      task.stats.lastError = err instanceof Error ? err.message : String(err);
      this.onError?.(task.options.name, err);
    } finally {
      task.running = false;
      task.stats.runs++;
      task.stats.busyMs += this.clock.now() - start;
    }
    if (task.every === null) {
      this.stop(task);
      return;
    }
    // Next tick on the original grid; ticks already passed are skipped as late.
    const now = this.clock.now();
    if (task.every === 0) task.due = now;
    else {
      task.due += task.every;
      if (task.due < now) {
        const missed = Math.ceil((now - task.due) / task.every);
        task.due += missed * task.every;
        task.stats.late += missed;
      }
    }
    this.arm(task);
  }
}
