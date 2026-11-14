// SPDX-License-Identifier: GPL-2.0-or-later
// Updates for the desktop app: offered, never forced. A quiet check a few
// seconds after launch (unless turned off) shows a notice, and the user picks:
// Update (download now, restart whenever they like), Later (ask again at the
// next launch) or Skip this version. Nothing downloads or installs on its own,
// and the check never runs during startup itself.
//
// The updater installs only what the release key signed (src-tauri/src/lib.rs);
// a build made without that key has no updater, and enabled() says so. This
// module holds the rules and talks to the host through an UpdaterBackend
// (desktop.ts has the Tauri one), so tests drive it with a fake.

export interface FoundUpdate {
  version: string;
  /** Release notes, possibly empty. */
  notes: string;
  /** Downloads the update and checks its signature; `total` is null when unknown. */
  download(onProgress: (done: number, total: number | null) => void): Promise<void>;
  /** Installs what was downloaded and restarts the app (on Windows the installer closes it first). */
  installAndRestart(): Promise<void>;
}

export interface UpdaterBackend {
  /** Whether this build can update itself at all. */
  enabled(): Promise<boolean>;
  /** The newer version on offer, or null when this one is current. */
  check(): Promise<FoundUpdate | null>;
}

/** Where the two update settings live (localStorage in the app). */
export interface UpdatePrefs {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; done: number; total: number | null }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string }
  /** After a check from the menu that found nothing. */
  | { kind: "upToDate" }
  | { kind: "failed"; message: string };

/** "off" turns the check at launch off. */
export const AUTO_CHECK_KEY = "vialink.updates.auto";
/** The version the user chose to skip; the launch check stays quiet about it. */
export const SKIPPED_KEY = "vialink.updates.skip";

export class Updater {
  private current: UpdateState = { kind: "idle" };
  private changes = 0;
  private found: FoundUpdate | null = null;
  private started = false;
  private canUpdate = false;
  private readonly listeners = new Set<() => void>();
  private readonly backend: UpdaterBackend;
  private readonly prefs: UpdatePrefs;

  constructor(backend: UpdaterBackend, prefs: UpdatePrefs) {
    this.backend = backend;
    this.prefs = prefs;
  }

  get state(): UpdateState {
    return this.current;
  }

  /** Goes up on every change, settings included (a snapshot for useSyncExternalStore). */
  get revision(): number {
    return this.changes;
  }

  /** False until start() found that this build can update itself. */
  get enabled(): boolean {
    return this.canUpdate;
  }

  get autoCheck(): boolean {
    return this.prefs.get(AUTO_CHECK_KEY) !== "off";
  }

  setAutoCheck(on: boolean): void {
    this.prefs.set(AUTO_CHECK_KEY, on ? null : "off");
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Called once at launch: learns whether this build can update, then checks
   * quietly after `delayMs` (so it never competes with startup) unless the
   * user turned that off. Later calls do nothing.
   */
  async start(delayMs: number, wait: (ms: number) => Promise<void> = sleep): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.canUpdate = await this.backend.enabled().catch(() => false);
    this.emit();
    if (!this.canUpdate || !this.autoCheck) return;
    await wait(delayMs);
    if (this.autoCheck) await this.check(false);
  }

  /**
   * Looks for a newer version. The launch check (`manual` false) is silent:
   * no "up to date", no errors (offline is normal), and nothing about a
   * version the user skipped. A check from the menu says how it went and
   * offers even a skipped version.
   */
  async check(manual: boolean): Promise<void> {
    if (!this.canUpdate || this.busy) return;
    if (manual) this.set({ kind: "checking" });
    try {
      const update = await this.backend.check();
      if (!update || (!manual && this.prefs.get(SKIPPED_KEY) === update.version)) {
        this.set(manual ? { kind: "upToDate" } : { kind: "idle" });
        return;
      }
      // Already downloaded (and put away with Later): offer the restart, not a second download.
      if (this.found && update.version === this.downloadedVersion) {
        this.set({ kind: "ready", version: update.version });
        return;
      }
      this.found = update;
      this.set({ kind: "available", version: update.version, notes: update.notes });
    } catch (err) {
      this.set(
        manual
          ? { kind: "failed", message: `Couldn't check for updates: ${message(err)}` }
          : { kind: "idle" },
      );
    }
  }

  /** Update: downloads the offered version; restarting stays the user's call. */
  async download(): Promise<void> {
    const found = this.found;
    if (!found || this.current.kind !== "available") return;
    const version = found.version;
    this.set({ kind: "downloading", version, done: 0, total: null });
    try {
      await found.download((done, total) => this.set({ kind: "downloading", version, done, total }));
      this.set({ kind: "ready", version });
    } catch (err) {
      this.set({ kind: "failed", message: `Couldn't download ViaLink ${version}: ${message(err)}` });
    }
  }

  /** Restart now: installs the downloaded version and restarts into it. */
  async installAndRestart(): Promise<void> {
    const found = this.found;
    if (!found || this.current.kind !== "ready") return;
    this.set({ kind: "installing", version: found.version });
    try {
      await found.installAndRestart();
    } catch (err) {
      this.set({ kind: "failed", message: `Couldn't install ViaLink ${found.version}: ${message(err)}` });
    }
  }

  /**
   * Later: hides the notice. A finished download stays until ViaLink closes
   * (the menu offers its restart); after that the next launch asks again.
   */
  later(): void {
    if (this.current.kind === "available" || this.current.kind === "ready") this.set({ kind: "idle" });
  }

  /** Skip this version: the launch check stays quiet about it from now on. */
  skip(): void {
    if (this.current.kind !== "available") return;
    this.prefs.set(SKIPPED_KEY, this.current.version);
    this.found = null;
    this.set({ kind: "idle" });
  }

  /** Closes an "up to date" or error notice. */
  dismiss(): void {
    if (this.current.kind === "upToDate" || this.current.kind === "failed") this.set({ kind: "idle" });
  }

  /** A downloaded version whose notice was put away with Later (the menu offers its restart). */
  get readyInBackground(): string | null {
    return this.current.kind === "idle" && this.found?.version === this.downloadedVersion
      ? this.downloadedVersion
      : null;
  }

  /** Brings back the "ready" notice after Later. */
  showReady(): void {
    const version = this.readyInBackground;
    if (version) this.set({ kind: "ready", version });
  }

  private downloadedVersion: string | null = null;

  private get busy(): boolean {
    const k = this.current.kind;
    return k === "checking" || k === "downloading" || k === "installing";
  }

  private set(state: UpdateState): void {
    if (state.kind === "ready") this.downloadedVersion = state.version;
    this.current = state;
    this.emit();
  }

  private emit(): void {
    this.changes++;
    for (const listener of this.listeners) listener();
  }
}

/** localStorage, quietly doing nothing where it is unavailable. */
export const browserPrefs: UpdatePrefs = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Private mode or storage blocked: the setting lasts until the app closes.
    }
  },
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
