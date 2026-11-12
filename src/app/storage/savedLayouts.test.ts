// SPDX-License-Identifier: GPL-2.0-or-later
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  defaultLayoutName,
  IndexedDbLayoutStore,
  StorageUnavailableError,
  type SavedLayout,
} from "./savedLayouts.ts";

const layout = (id: string, savedAt: string): SavedLayout => ({
  id,
  name: `Layout ${id}`,
  uid: "18364758544493064720",
  keyboardName: "Klor",
  savedAt,
  vil: '{"version": 1}',
});

describe("IndexedDbLayoutStore", () => {
  it("stores, lists newest first, renames and deletes", async () => {
    const store = new IndexedDbLayoutStore(new IDBFactory());
    await store.put(layout("a", "2026-11-10T10:00:00.000Z"));
    await store.put(layout("b", "2026-11-11T10:00:00.000Z"));
    expect((await store.list()).map((l) => l.id)).toEqual(["b", "a"]);

    await store.put({ ...layout("a", "2026-11-10T10:00:00.000Z"), name: "Gaming" });
    expect((await store.get("a"))?.name).toBe("Gaming");
    // The u64 uid survives as an exact string.
    expect((await store.get("a"))?.uid).toBe("18364758544493064720");

    await store.delete("b");
    expect((await store.list()).map((l) => l.id)).toEqual(["a"]);
  });

  it("keeps data across store instances on the same database", async () => {
    const factory = new IDBFactory();
    await new IndexedDbLayoutStore(factory).put(layout("x", "2026-11-11T00:00:00.000Z"));
    expect((await new IndexedDbLayoutStore(factory).list()).map((l) => l.id)).toEqual(["x"]);
  });

  it("reports unusable storage clearly", async () => {
    const store = new IndexedDbLayoutStore(undefined);
    await expect(store.list()).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("names layouts after the keyboard and time", () => {
    expect(defaultLayoutName("Klor", new Date(2026, 10, 11, 9, 5))).toBe("Klor 2026-11-11 09:05");
  });
});
