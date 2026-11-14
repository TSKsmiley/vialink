// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { CommunicationError, RequestQueue } from "./queue.ts";
import { ReplayMismatchError, ReplayTransport } from "./replay.ts";
import { BatchError, DeviceDisconnectedError, TransportTimeoutError, type Transport } from "./types.ts";

function fakeTransport(handler: (r: Uint8Array) => Promise<Uint8Array>) {
  const listeners = new Set<() => void>();
  const t: Transport & { unplug(): void } = {
    info: { productName: "fake", vendorId: 1, productId: 2 },
    open: async () => undefined,
    close: async () => undefined,
    send: handler,
    onDisconnect: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    unplug: () => listeners.forEach((cb) => cb()),
  };
  return t;
}

describe("RequestQueue", () => {
  it("pads requests to 32 bytes and keeps one request in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const t = fakeTransport(async (r) => {
      expect(r.length).toBe(32);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 2));
      inFlight--;
      return r;
    });
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    const replies = await Promise.all([1, 2, 3, 4].map((n) => q.request([n])));
    expect(replies.map((r) => r[0])).toEqual([1, 2, 3, 4]);
    expect(maxInFlight).toBe(1);
  });

  it("retries timeouts and gives up after the retry budget", async () => {
    let calls = 0;
    const q = new RequestQueue(
      fakeTransport(async () => {
        calls++;
        throw new TransportTimeoutError();
      }),
      { retryDelayMs: 0 },
    );
    await expect(q.request([1], { retries: 3 })).rejects.toBeInstanceOf(CommunicationError);
    expect(calls).toBe(3);
    // The queue keeps working after a failure.
    calls = 0;
    await expect(q.request([2], { retries: 1 })).rejects.toBeInstanceOf(CommunicationError);
    expect(calls).toBe(1);
  });

  it("fails fast once the device is unplugged", async () => {
    const t = fakeTransport(async (r) => r);
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    t.unplug();
    await expect(q.request([1])).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("exports successful exchanges as a trace that replays", async () => {
    const q = new RequestQueue(
      fakeTransport(async (r) => Uint8Array.from([r[0], 0xaa])),
      { retryDelayMs: 0 },
    );
    await q.request([0x11]);
    await q.request([0x01]);
    const trace = q.exportTrace("test");
    expect(trace.exchanges).toEqual([
      { request: "11", reply: "11aa" },
      { request: "01", reply: "01aa" },
    ]);

    const replay = new ReplayTransport(trace);
    await replay.open();
    const rq = new RequestQueue(replay, { retryDelayMs: 0 });
    expect((await rq.request([0x11]))[1]).toBe(0xaa);
    await expect(rq.request([0x12], { retries: 1 })).rejects.toThrow(/expected request 01, got 12/);

    const lookup = new ReplayTransport(trace, { mode: "lookup" });
    await lookup.open();
    expect((await lookup.send(new Uint8Array(32).fill(0).map((_, i) => (i === 0 ? 1 : 0))))[1]).toBe(0xaa);
    await expect(lookup.send(new Uint8Array(32))).rejects.toBeInstanceOf(ReplayMismatchError);
  });
});

describe("RequestQueue.requestMany", () => {
  const echo = async (r: Uint8Array) => r;

  it("sends one at a time when the transport has no sendMany, as one job", async () => {
    const sent: number[] = [];
    const t = fakeTransport(async (r) => {
      sent.push(r[0]);
      return r;
    });
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    const [batch, single] = await Promise.all([q.requestMany([[1], [2], [3]]), q.request([9])]);
    expect(batch.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(single[0]).toBe(9);
    expect(sent).toEqual([1, 2, 3, 9]); // nothing in between
  });

  it("hands the whole batch to sendMany and logs a request and reply per report", async () => {
    const t = fakeTransport(echo);
    const batches: number[][] = [];
    t.sendMany = async (reports) => {
      batches.push(reports.map((r) => r[0]));
      expect(reports.every((r) => r.length === 32)).toBe(true);
      return reports.map((r) => r);
    };
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    const kinds: string[] = [];
    q.subscribe((e) => kinds.push(`${e.kind}${"data" in e ? e.data[0] : ""}`));
    const replies = await q.requestMany([[1], [2], [3]]);
    expect(replies.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(batches).toEqual([[1, 2, 3]]);
    expect(kinds).toEqual(["request1", "reply1", "request2", "reply2", "request3", "reply3"]);
    expect(q.exportTrace().exchanges).toHaveLength(3);
  });

  it("keeps the replies before a failure and retries the rest one at a time", async () => {
    let attempts = 0;
    const t = fakeTransport(async (r) => {
      if (r[0] === 2 && attempts++ === 0) throw new TransportTimeoutError();
      return r;
    });
    t.sendMany = async (reports) => {
      throw new BatchError(new TransportTimeoutError(), [reports[0]]);
    };
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    const replies = await q.requestMany([[1], [2], [3]]);
    expect(replies.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(attempts).toBe(2); // report 2 timed out once more on its own, then went through
  });

  it("stops at an unplug inside the batch", async () => {
    const t = fakeTransport(echo);
    t.sendMany = async (reports) => {
      throw new BatchError(new DeviceDisconnectedError(), [reports[0]]);
    };
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    await expect(q.requestMany([[1], [2], [3]])).rejects.toBeInstanceOf(DeviceDisconnectedError);
    expect(q.isDisconnected).toBe(true);
    await expect(q.request([4])).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("rejects an oversized report without sending anything", async () => {
    const sent: number[] = [];
    const t = fakeTransport(async (r) => {
      sent.push(r[0]);
      return r;
    });
    const q = new RequestQueue(t, { retryDelayMs: 0 });
    await expect(q.requestMany([[1], new Uint8Array(33)])).rejects.toThrow("at most 32 bytes");
    expect(sent).toEqual([]);
  });
});
