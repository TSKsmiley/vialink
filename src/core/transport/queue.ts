// SPDX-License-Identifier: GPL-2.0-or-later
// Single-flight request queue, mirroring vial-gui's util.py::hid_send: pad to
// 32 bytes, send, wait for the reply, retry after 500 ms on failure. Every
// command in the app goes through one queue per keyboard, so unlock and matrix
// polling can never interleave with a keymap write.

import { padTo } from "../util/bytes.ts";
import { makeExchange, type Trace, type TraceExchange } from "./trace.ts";
import { DeviceDisconnectedError, MSG_LEN, type Transport } from "./types.ts";

export interface RequestOptions {
  /** Attempts before giving up. vial-gui uses 20 for nearly every command. */
  retries?: number;
}

export type QueueEvent =
  | { kind: "request"; at: number; data: Uint8Array; attempt: number }
  | { kind: "reply"; at: number; data: Uint8Array; request: Uint8Array }
  | { kind: "retry"; at: number; request: Uint8Array; attempt: number; error: string }
  | { kind: "failed"; at: number; request: Uint8Array; error: string }
  | { kind: "disconnected"; at: number };

export class CommunicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunicationError";
  }
}

const DEFAULT_RETRIES = 20;

export class RequestQueue {
  readonly transport: Transport;
  private readonly retryDelayMs: number;
  private chain: Promise<unknown> = Promise.resolve();
  private disconnected = false;
  private readonly listeners = new Set<(event: QueueEvent) => void>();
  private readonly exchanges: TraceExchange[] = [];
  private readonly unsubscribeDisconnect: () => void;

  constructor(transport: Transport, options: { retryDelayMs?: number } = {}) {
    this.transport = transport;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.unsubscribeDisconnect = transport.onDisconnect(() => {
      this.disconnected = true;
      this.emit({ kind: "disconnected", at: Date.now() });
    });
  }

  get isDisconnected(): boolean {
    return this.disconnected;
  }

  /** Subscribes to every request, reply and failure; returns an unsubscribe function. */
  subscribe(listener: (event: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Sends `payload` (zero-padded to 32 bytes) once every earlier request has
   * finished, and resolves with the 32-byte reply.
   */
  request(payload: Uint8Array | number[], options: RequestOptions = {}): Promise<Uint8Array> {
    const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
    if (bytes.length > MSG_LEN) {
      return Promise.reject(new Error(`message must be at most ${MSG_LEN} bytes, got ${bytes.length}`));
    }
    const report = padTo(bytes, MSG_LEN);
    const run = this.chain.then(() => this.run(report, options.retries ?? DEFAULT_RETRIES));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Exports every successful exchange so far as a replayable trace. */
  exportTrace(note?: string): Trace {
    return {
      format: "vial-ts-trace",
      version: 1,
      device: this.transport.info,
      recordedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
      exchanges: [...this.exchanges],
    };
  }

  clearTrace(): void {
    this.exchanges.length = 0;
  }

  async close(): Promise<void> {
    this.unsubscribeDisconnect();
    this.disconnected = true;
    await this.transport.close();
  }

  private async run(report: Uint8Array, retries: number): Promise<Uint8Array> {
    let lastError = "no attempts made";
    for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
      if (this.disconnected) {
        throw new DeviceDisconnectedError();
      }
      if (attempt > 1) {
        await sleep(this.retryDelayMs);
        if (this.disconnected) throw new DeviceDisconnectedError();
      }
      this.emit({ kind: "request", at: Date.now(), data: report, attempt });
      try {
        const reply = await this.transport.send(report);
        this.exchanges.push(makeExchange(report, reply));
        this.emit({ kind: "reply", at: Date.now(), data: reply, request: report });
        return reply;
      } catch (err) {
        if (err instanceof DeviceDisconnectedError) {
          this.disconnected = true;
          this.emit({ kind: "failed", at: Date.now(), request: report, error: err.message });
          throw err;
        }
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < retries) {
          this.emit({ kind: "retry", at: Date.now(), request: report, attempt, error: lastError });
        }
      }
    }
    this.emit({ kind: "failed", at: Date.now(), request: report, error: lastError });
    throw new CommunicationError(
      `failed to communicate with the device after ${retries} attempts: ${lastError}`,
    );
  }

  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
