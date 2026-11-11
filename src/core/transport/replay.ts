// SPDX-License-Identifier: GPL-2.0-or-later
// Plays back a recorded trace in place of a keyboard.
//
// "strict" mode expects the exact request sequence of the recording, which is
// what a regression test of a whole flow wants. "lookup" mode answers any
// request that appears somewhere in the trace (latest recorded reply wins), for
// tests that only care that every request we send is one the real keyboard has
// answered. Either way an unknown request throws, naming the request.

import { toTrimmedHex } from "../util/bytes.ts";
import { reportFromHex, type Trace } from "./trace.ts";
import { DeviceDisconnectedError, type DeviceInfo, type Transport } from "./types.ts";

export class ReplayMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayMismatchError";
  }
}

export class ReplayTransport implements Transport {
  readonly info: DeviceInfo;
  private readonly trace: Trace;
  private readonly mode: "strict" | "lookup";
  private readonly lookup = new Map<string, string>();
  private index = 0;
  private closed = false;
  private readonly disconnectListeners = new Set<() => void>();

  constructor(trace: Trace, options: { mode?: "strict" | "lookup" } = {}) {
    this.trace = trace;
    this.info = trace.device;
    this.mode = options.mode ?? "strict";
    for (const ex of trace.exchanges) {
      this.lookup.set(ex.request, ex.reply);
    }
  }

  async open(): Promise<void> {
    this.closed = false;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  /** Simulates an unplug, for testing disconnect handling. */
  unplug(): void {
    this.closed = true;
    for (const cb of this.disconnectListeners) cb();
  }

  /** Number of exchanges consumed so far (strict mode). */
  get consumed(): number {
    return this.index;
  }

  /** True when strict playback has used every recorded exchange. */
  get finished(): boolean {
    return this.index === this.trace.exchanges.length;
  }

  async send(report: Uint8Array): Promise<Uint8Array> {
    if (this.closed) throw new DeviceDisconnectedError();
    const request = toTrimmedHex(report);

    if (this.mode === "lookup") {
      const reply = this.lookup.get(request);
      if (reply === undefined) {
        throw new ReplayMismatchError(`request ${request || "(empty)"} does not appear in the trace`);
      }
      return reportFromHex(reply);
    }

    const expected = this.trace.exchanges[this.index];
    if (!expected) {
      throw new ReplayMismatchError(
        `trace exhausted after ${this.index} exchanges; unexpected request ${request || "(empty)"}`,
      );
    }
    if (expected.request !== request) {
      throw new ReplayMismatchError(
        `exchange ${this.index}: expected request ${expected.request}, got ${request || "(empty)"}`,
      );
    }
    this.index += 1;
    return reportFromHex(expected.reply);
  }
}
