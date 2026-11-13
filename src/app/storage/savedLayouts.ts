// SPDX-License-Identifier: GPL-2.0-or-later
// Layouts saved in the browser (IndexedDB), so a user can keep snapshots of a
// keyboard's configuration without handling .vil files. Each entry stores the
// same .vil text a file download would contain, so it loads through the same
// restore path and can still be downloaded as a file later.
//
// Browser storage belongs to this browser profile and this site only, and the
// browser may clear it under storage pressure unless it is marked persistent;
// requestPersistence() asks for that.

export interface SavedLayout {
  id: string;
  name: string;
  /** Keyboard UID as a decimal string (u64 does not fit a JS number). */
  uid: string;
  keyboardName: string;
  /** ISO 8601 timestamp. */
  savedAt: string;
  /** The layout file: .vialink JSON, or .vil text for layouts saved before .vialink (both load). */
  vil: string;
}

export interface SavedLayoutStore {
  list(): Promise<SavedLayout[]>;
  get(id: string): Promise<SavedLayout | undefined>;
  put(layout: SavedLayout): Promise<void>;
  delete(id: string): Promise<void>;
}

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "This browser is not letting ViaLink store data (private window or blocked site data?). " +
        "Use Save .vil to keep a file instead.",
    );
    this.name = "StorageUnavailableError";
    this.cause = cause;
  }
}

// Named after the project's old name, vial-ts; kept so layouts saved earlier stay readable.
const DB_NAME = "vial-ts";
const DB_VERSION = 1;
const STORE = "layouts";

/** IndexedDB-backed store. Opens lazily; every call fails with StorageUnavailableError if IndexedDB is unusable. */
export class IndexedDbLayoutStore implements SavedLayoutStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory | undefined;

  constructor(factory: IDBFactory | undefined = globalThis.indexedDB) {
    this.factory = factory;
  }

  async list(): Promise<SavedLayout[]> {
    const all = await this.run<SavedLayout[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  get(id: string): Promise<SavedLayout | undefined> {
    return this.run("readonly", (s) => s.get(id));
  }

  async put(layout: SavedLayout): Promise<void> {
    await this.run("readwrite", (s) => s.put(layout));
  }

  async delete(id: string): Promise<void> {
    await this.run("readwrite", (s) => s.delete(id));
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        if (!this.factory) {
          reject(new StorageUnavailableError());
          return;
        }
        let request: IDBOpenDBRequest;
        try {
          request = this.factory.open(DB_NAME, DB_VERSION);
        } catch (err) {
          reject(new StorageUnavailableError(err));
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex("uid", "uid");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new StorageUnavailableError(request.error));
        request.onblocked = () => reject(new StorageUnavailableError("database upgrade blocked"));
      });
      // A failed open is retried on the next call rather than cached forever.
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("storage transaction aborted"));
    });
  }
}

/** In-memory store, for tests and as a fallback when IndexedDB is unusable. */
export class MemoryLayoutStore implements SavedLayoutStore {
  private readonly items = new Map<string, SavedLayout>();
  async list(): Promise<SavedLayout[]> {
    return [...this.items.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async get(id: string): Promise<SavedLayout | undefined> {
    return this.items.get(id);
  }
  async put(layout: SavedLayout): Promise<void> {
    this.items.set(layout.id, { ...layout });
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export function newLayoutId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function defaultLayoutName(keyboardName: string, when = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${keyboardName} ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * Asks the browser to keep this site's storage when space runs low. Returns
 * whether storage is (now) persistent; false when the browser declines or
 * the API is missing.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

let shared: SavedLayoutStore | null = null;

/** The app-wide store (IndexedDB). */
export function layoutStore(): SavedLayoutStore {
  shared ??= new IndexedDbLayoutStore();
  return shared;
}

/** Replaces the app-wide store (tests). */
export function setLayoutStore(store: SavedLayoutStore | null): void {
  shared = store;
}
