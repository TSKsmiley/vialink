// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { NativeHidTransport, type NativeHidBridge, type NativeKeyboard } from "./native.ts";
import { RequestQueue } from "./queue.ts";
import { BatchError, DeviceDisconnectedError, TransportTimeoutError } from "./types.ts";

const KLOR: NativeKeyboard = {
  path: "/dev/hidraw3",
  productName: "KLOR",
  vendorId: 0x3a3c,
  productId: 0x0001,
  serial: "vial:f64c2b3c",
};

/** A host that answers from a simulated keyboard, and can unplug it. */
function fakeHost(sim: SimulatedKeyboard) {
  const listeners = new Set<(handle: number) => void>();
  const calls: string[] = [];
  let next = 7;
  const bridge: NativeHidBridge = {
    list: async () => [KLOR],
    open: async (path) => {
      calls.push(`open ${path}`);
      return next++;
    },
    request: async (handle, report, timeoutMs) => {
      calls.push(`request ${handle} ${report[0]} ${timeoutMs}`);
      return sim.send(report);
    },
    requestMany: async (handle, reports, timeoutMs) => {
      calls.push(`requestMany ${handle} ${reports.length} ${timeoutMs}`);
      const replies: Uint8Array[] = [];
      for (const r of reports) replies.push(await sim.send(r));
      return replies;
    },
    close: async (handle) => {
      calls.push(`close ${handle}`);
    },
    onDisconnect: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { bridge, calls, unplug: (handle: number) => listeners.forEach((cb) => cb(handle)), listeners };
}

const klorXz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/klor.vial.json.xz", import.meta.url)),
);

function klor() {
  return new SimulatedKeyboard({ compressedDefinition: klorXz, rows: 8, cols: 6, layers: 4 });
}

describe("NativeHidTransport", () => {
  it("loads a keyboard through the bridge", async () => {
    const sim = klor();
    await sim.open();
    const host = fakeHost(sim);
    const transport = new NativeHidTransport(host.bridge, KLOR);
    expect(transport.info).toEqual({ productName: "KLOR", vendorId: 0x3a3c, productId: 0x0001 });
    await transport.open();
    const kb = await Keyboard.load(new RequestQueue(transport, { retryDelayMs: 0 }));
    expect(kb.layers).toBe(4);
    expect(host.calls[0]).toBe("open /dev/hidraw3");
    expect(host.calls[1]).toBe("request 7 1 500"); // VIA protocol version first, 500 ms timeout
    // The keymap goes over in one batch: 4 layers x 8 rows x 6 cols x 2 bytes / 28 per report.
    expect(host.calls).toContain("requestMany 7 14 500");
  });

  it("passes a failed batch on and treats an unplug inside it as one", async () => {
    const host = fakeHost(klor());
    const transport = new NativeHidTransport(host.bridge, KLOR);
    let unplugged = 0;
    transport.onDisconnect(() => unplugged++);
    await transport.open();
    host.bridge.requestMany = () =>
      Promise.reject(new BatchError(new TransportTimeoutError(), [new Uint8Array(32)]));
    await expect(transport.sendMany([new Uint8Array(32), new Uint8Array(32)])).rejects.toBeInstanceOf(
      BatchError,
    );
    expect(unplugged).toBe(0);
    host.bridge.requestMany = () => Promise.reject(new BatchError(new DeviceDisconnectedError(), []));
    await expect(transport.sendMany([new Uint8Array(32)])).rejects.toBeInstanceOf(BatchError);
    expect(unplugged).toBe(1);
    await expect(transport.sendMany([new Uint8Array(32)])).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("refuses reports that are not 32 bytes and sends nothing before open", async () => {
    const host = fakeHost(klor());
    const transport = new NativeHidTransport(host.bridge, KLOR);
    await expect(transport.send(new Uint8Array(32))).rejects.toThrow("not open");
    await transport.open();
    await expect(transport.send(new Uint8Array(31))).rejects.toThrow("32 bytes");
    expect(host.calls).toEqual(["open /dev/hidraw3"]);
  });

  it("passes timeouts through without treating them as an unplug", async () => {
    const host = fakeHost(klor());
    host.bridge.request = () => Promise.reject(new TransportTimeoutError());
    const transport = new NativeHidTransport(host.bridge, KLOR);
    let unplugged = 0;
    transport.onDisconnect(() => unplugged++);
    await transport.open();
    await expect(transport.send(new Uint8Array(32))).rejects.toBeInstanceOf(TransportTimeoutError);
    await expect(transport.send(new Uint8Array(32))).rejects.toBeInstanceOf(TransportTimeoutError);
    expect(unplugged).toBe(0);
  });

  it("reports an unplug from the host once, for its own handle only", async () => {
    const sim = klor();
    await sim.open();
    const host = fakeHost(sim);
    const transport = new NativeHidTransport(host.bridge, KLOR);
    let unplugged = 0;
    transport.onDisconnect(() => unplugged++);
    await transport.open();
    host.unplug(99); // another keyboard
    expect(unplugged).toBe(0);
    host.unplug(7);
    host.unplug(7);
    expect(unplugged).toBe(1);
    expect(host.listeners.size).toBe(0);
    await expect(transport.send(new Uint8Array(32))).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("treats a disconnected error from a request as an unplug", async () => {
    const host = fakeHost(klor());
    host.bridge.request = () => Promise.reject(new DeviceDisconnectedError());
    const transport = new NativeHidTransport(host.bridge, KLOR);
    let unplugged = 0;
    transport.onDisconnect(() => unplugged++);
    await transport.open();
    await expect(transport.send(new Uint8Array(32))).rejects.toBeInstanceOf(DeviceDisconnectedError);
    expect(unplugged).toBe(1);
  });

  it("closes the handle and stops listening", async () => {
    const host = fakeHost(klor());
    const transport = new NativeHidTransport(host.bridge, KLOR);
    let unplugged = 0;
    transport.onDisconnect(() => unplugged++);
    await transport.open();
    await transport.close();
    expect(host.calls).toEqual(["open /dev/hidraw3", "close 7"]);
    expect(host.listeners.size).toBe(0);
    expect(unplugged).toBe(0); // closing is not an unplug
    await expect(transport.send(new Uint8Array(32))).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("stops listening when opening fails", async () => {
    const host = fakeHost(klor());
    host.bridge.open = () => Promise.reject(new Error("could not open the keyboard: permission denied"));
    const transport = new NativeHidTransport(host.bridge, KLOR);
    await expect(transport.open()).rejects.toThrow("permission denied");
    expect(host.listeners.size).toBe(0);
  });
});
