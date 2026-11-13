// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "./keyboard.ts";
import { vialGetKeyboardId } from "./protocol/commands.ts";
import { Scheduler, type Clock } from "./scheduler.ts";
import { SimulatedKeyboard } from "./sim/simulatedKeyboard.ts";
import { RequestQueue } from "./transport/queue.ts";
import type { DeviceContext, KeyboardExtension } from "./extensions/types.ts";

/** A clock whose time only moves when the test says so. */
function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(++nextId, { at: now + ms, fn });
      return nextId;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** Moves time forward, firing due timers in order and letting their runs finish. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].fn();
      await flush();
    }
    now = Math.max(now, end);
    await flush();
  };
  return { clock, advance, setNow: (t: number) => (now = t) };
}

const opts = { name: "t", owner: "ext" };

describe("scheduler", () => {
  it("runs every interval, once, and stops", async () => {
    const { clock, advance } = fakeClock();
    const s = new Scheduler({ clock });
    let runs = 0;
    let once = 0;
    const task = s.every(50, () => void runs++, opts);
    s.once(120, () => void once++, opts);
    await advance(160);
    expect(runs).toBe(3);
    expect(once).toBe(1);
    task.stop();
    await advance(200);
    expect(runs).toBe(3);
    expect(task.stats).toMatchObject({ runs: 3, late: 0, errors: 0 });
    expect(s.stats()).toEqual([]); // the once task ended, the other was stopped
  });

  it("doesn't pile up: a slow run skips the ticks it overlaps, counted as late", async () => {
    const { clock, advance, setNow } = fakeClock();
    const s = new Scheduler({ clock });
    let starts = 0;
    const task = s.every(
      50,
      async () => {
        starts++;
        setNow(clock.now() + 120); // this run takes 120 ms
        await Promise.resolve();
      },
      opts,
    );
    await advance(50);
    expect(starts).toBe(1);
    expect(task.stats.late).toBe(2); // ticks at 100 and 150 passed during the run
    expect(task.stats.busyMs).toBe(120);
    await advance(30); // next tick at 200
    expect(starts).toBe(2);
  });

  it("pauses, counts no late runs for the pause, and keeps essential tasks going", async () => {
    const { clock, advance } = fakeClock();
    const s = new Scheduler({ clock });
    let normal = 0;
    let essential = 0;
    const task = s.every(50, () => void normal++, opts);
    s.every(50, () => void essential++, { ...opts, essential: true });
    s.pause("operation");
    await advance(500);
    expect([normal, essential]).toEqual([0, 10]);
    s.resume("operation");
    await advance(0);
    expect(normal).toBe(1); // overdue: runs once, right away
    expect(task.stats.late).toBe(0);
    s.pause("disconnected");
    await advance(500);
    expect(essential).toBe(10); // a disconnect stops everything
  });

  it("stops an owner's tasks and records errors", async () => {
    const { clock, advance } = fakeClock();
    const s = new Scheduler({ clock });
    const errors: string[] = [];
    s.onError = (name, err) => errors.push(`${name}: ${(err as Error).message}`);
    const failing = s.every(
      10,
      () => {
        throw new Error("boom");
      },
      { name: "flaky", owner: "a" },
    );
    s.every(10, () => undefined, { name: "other", owner: "b" });
    await advance(20);
    expect(failing.stats).toMatchObject({ errors: 2, lastError: "boom", runs: 2 });
    expect(errors).toEqual(["flaky: boom", "flaky: boom"]);
    s.stopOwner("a");
    expect(s.stats().map((t) => t.name)).toEqual(["other"]);
  });

  it("runs idle work only when nothing else is busy", async () => {
    const { clock, advance } = fakeClock();
    let busy = true;
    const s = new Scheduler({ clock, busy: () => busy });
    let ran = 0;
    s.idle(() => void ran++, opts);
    await advance(300);
    expect(ran).toBe(0);
    busy = false;
    await advance(100);
    expect(ran).toBe(1);
  });
});

describe("request queue lanes", () => {
  it("sends normal requests before queued low-priority ones", async () => {
    const sent: number[] = [];
    const transport = {
      info: { vendorId: 0, productId: 0, productName: "t" },
      open: async () => undefined,
      close: async () => undefined,
      onDisconnect: () => () => undefined,
      send: async (data: Uint8Array) => {
        sent.push(data[0]);
        return new Uint8Array(32);
      },
    };
    const q = new RequestQueue(transport as never, { retryDelayMs: 0 });
    const all = [
      q.request([1]),
      q.request([2], { priority: "low" }),
      q.request([3], { priority: "low" }),
      q.request([4]),
    ];
    await Promise.all(all);
    expect(sent).toEqual([1, 4, 2, 3]);
  });
});

const xz = new Uint8Array(
  readFileSync(new URL("../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

describe("ctx.schedule on a keyboard", () => {
  async function setup() {
    let ctx: DeviceContext | null = null;
    const ext: KeyboardExtension<unknown> = {
      id: "poller",
      name: "Poller",
      description: "",
      group: "standard",
      async probe(c) {
        ctx = c;
        return {};
      },
    };
    const sim = new SimulatedKeyboard({
      compressedDefinition: xz,
      rows: 2,
      cols: 2,
      layers: 2,
      encoderCount: 1,
    });
    await sim.open();
    const queue = new RequestQueue(sim, { retryDelayMs: 0 });
    const kb = await Keyboard.load(queue, { extensions: [ext] });
    return { kb, queue, ext, ctx: ctx! as DeviceContext };
  }

  it("counts the task's requests, sends them in the low lane and stops them when turned off", async () => {
    const { kb, ctx, ext } = await setup();
    const task = ctx.schedule.every(
      1,
      () => ctx.device.request(vialGetKeyboardId.encode()).then(() => undefined),
      {
        name: "id",
      },
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(task.stats.runs).toBeGreaterThan(0);
    expect(task.stats.requests).toBe(task.stats.runs);
    expect(kb.scheduler.stats()).toEqual([expect.objectContaining({ name: "id", owner: "poller" })]);
    await kb.setExtensionEnabled(ext, false);
    expect(kb.scheduler.stats()).toEqual([]);
  });

  it("pauses while an operation writes", async () => {
    const { kb } = await setup();
    await kb.history.group("Paste", async () => {
      expect(kb.scheduler.paused.has("operation")).toBe(true);
    });
    expect(kb.scheduler.paused.has("operation")).toBe(false);
  });
});
