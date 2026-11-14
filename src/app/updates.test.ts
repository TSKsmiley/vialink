// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  AUTO_CHECK_KEY,
  SKIPPED_KEY,
  Updater,
  type FoundUpdate,
  type UpdatePrefs,
  type UpdaterBackend,
} from "./updates.ts";

function memoryPrefs(initial: Record<string, string> = {}): UpdatePrefs & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: (key) => data[key] ?? null,
    set: (key, value) => {
      if (value === null) delete data[key];
      else data[key] = value;
    },
  };
}

function fakeHost(options: { enabled?: boolean; offer?: string | null; fail?: string } = {}) {
  const log: string[] = [];
  let offer = options.offer === undefined ? "0.2.0" : options.offer;
  const update = (version: string): FoundUpdate => ({
    version,
    notes: "## What's new\n- Faster loads",
    download: async (onProgress) => {
      log.push(`download ${version}`);
      onProgress(50, 100);
      onProgress(100, 100);
    },
    installAndRestart: async () => {
      log.push(`install ${version}`);
    },
  });
  const backend: UpdaterBackend = {
    enabled: async () => options.enabled ?? true,
    check: async () => {
      log.push("check");
      if (options.fail) throw new Error(options.fail);
      return offer ? update(offer) : null;
    },
  };
  return { backend, log, setOffer: (v: string | null) => (offer = v) };
}

const now = () => Promise.resolve();

describe("Updater", () => {
  it("checks quietly after the delay and offers the new version", async () => {
    const host = fakeHost();
    const u = new Updater(host.backend, memoryPrefs());
    const waits: number[] = [];
    await u.start(5000, async (ms) => void waits.push(ms));
    expect(waits).toEqual([5000]);
    expect(u.enabled).toBe(true);
    expect(u.state).toEqual({ kind: "available", version: "0.2.0", notes: "## What's new\n- Faster loads" });
  });

  it("does nothing in a build without the updater, and starts once", async () => {
    const host = fakeHost({ enabled: false });
    const u = new Updater(host.backend, memoryPrefs());
    await u.start(0, now);
    await u.start(0, now);
    await u.check(true);
    expect(u.enabled).toBe(false);
    expect(host.log).toEqual([]);
    expect(u.state.kind).toBe("idle");
  });

  it("skips the launch check when it is turned off, but a menu check still works", async () => {
    const host = fakeHost();
    const prefs = memoryPrefs({ [AUTO_CHECK_KEY]: "off" });
    const u = new Updater(host.backend, prefs);
    await u.start(0, now);
    expect(host.log).toEqual([]);
    expect(u.autoCheck).toBe(false);
    await u.check(true);
    expect(u.state.kind).toBe("available");
    u.setAutoCheck(true);
    expect(prefs.data[AUTO_CHECK_KEY]).toBeUndefined();
  });

  it("stays quiet about a skipped version at launch, offers it from the menu", async () => {
    const host = fakeHost();
    const prefs = memoryPrefs();
    const first = new Updater(host.backend, prefs);
    await first.start(0, now);
    first.skip();
    expect(prefs.data[SKIPPED_KEY]).toBe("0.2.0");
    expect(first.state.kind).toBe("idle");

    const next = new Updater(host.backend, prefs);
    await next.start(0, now);
    expect(next.state.kind).toBe("idle");
    await next.check(true);
    expect(next.state.kind).toBe("available");

    host.setOffer("0.3.0"); // a newer one is offered again at launch
    const later = new Updater(host.backend, prefs);
    await later.start(0, now);
    expect(later.state).toMatchObject({ kind: "available", version: "0.3.0" });
  });

  it("says up to date, and why a check failed, only when asked from the menu", async () => {
    const quietHost = fakeHost({ fail: "offline" });
    const quiet = new Updater(quietHost.backend, memoryPrefs());
    await quiet.start(0, now);
    expect(quiet.state.kind).toBe("idle");
    await quiet.check(true);
    expect(quiet.state).toEqual({ kind: "failed", message: "Couldn't check for updates: offline" });
    quiet.dismiss();
    expect(quiet.state.kind).toBe("idle");

    const current = new Updater(fakeHost({ offer: null }).backend, memoryPrefs());
    await current.start(0, now);
    expect(current.state.kind).toBe("idle");
    await current.check(true);
    expect(current.state.kind).toBe("upToDate");
  });

  it("downloads only on Update and installs only on Restart now", async () => {
    const host = fakeHost();
    const u = new Updater(host.backend, memoryPrefs());
    const seen: string[] = [];
    u.subscribe(() => {
      const s = u.state;
      seen.push(s.kind === "downloading" ? `downloading ${s.done}/${s.total}` : s.kind);
    });
    await u.start(0, now);
    expect(host.log).toEqual(["check"]);
    await u.download();
    expect(u.state).toEqual({ kind: "ready", version: "0.2.0" });
    expect(host.log).toEqual(["check", "download 0.2.0"]);
    await u.installAndRestart();
    expect(host.log).toEqual(["check", "download 0.2.0", "install 0.2.0"]);
    expect(seen).toEqual([
      "idle", // enabled() answered
      "available",
      "downloading 0/null",
      "downloading 50/100",
      "downloading 100/100",
      "ready",
      "installing",
    ]);
  });

  it("keeps a download put away with Later, and offers its restart instead of downloading again", async () => {
    const host = fakeHost();
    const u = new Updater(host.backend, memoryPrefs());
    await u.start(0, now);
    await u.download();
    u.later();
    expect(u.state.kind).toBe("idle");
    expect(u.readyInBackground).toBe("0.2.0");
    await u.check(true);
    expect(u.state).toEqual({ kind: "ready", version: "0.2.0" });
    expect(host.log.filter((l) => l.startsWith("download"))).toHaveLength(1);
    u.later();
    u.showReady();
    expect(u.state.kind).toBe("ready");
  });

  it("reports a failed download and lets it be dismissed", async () => {
    const host = fakeHost();
    host.backend.check = async () => ({
      version: "0.2.0",
      notes: "",
      download: async () => {
        throw new Error("signature mismatch");
      },
      installAndRestart: async () => undefined,
    });
    const u = new Updater(host.backend, memoryPrefs());
    await u.start(0, now);
    await u.download();
    expect(u.state).toEqual({
      kind: "failed",
      message: "Couldn't download ViaLink 0.2.0: signature mismatch",
    });
    expect(u.readyInBackground).toBeNull();
  });
});
