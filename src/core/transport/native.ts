// SPDX-License-Identifier: GPL-2.0-or-later
// Native raw-HID transport for the desktop app, whose webview has no WebHID
// (WebKit on macOS and Linux). The host process owns the device
// (src-tauri/src/hid.rs): it writes each report, matches the reply to it by
// count and times out, like transport/webhid.ts does in the page. This side
// reaches it through a NativeHidBridge, so the core stays free of Tauri and
// runs under Node in tests; src/app/desktop.ts provides the Tauri bridge.

import { BatchError, DeviceDisconnectedError, MSG_LEN, type DeviceInfo, type Transport } from "./types.ts";

/** A keyboard with the VIA/Vial raw-HID interface (usage page 0xFF60, usage 0x61). */
export interface NativeKeyboard {
  /** The host's device path; opaque, only passed back to `open`. */
  path: string;
  productName: string;
  vendorId: number;
  productId: number;
  serial: string;
}

/** What the host process offers. Errors are already mapped to the Transport ones. */
export interface NativeHidBridge {
  list(): Promise<NativeKeyboard[]>;
  /** Opens a keyboard and resolves with a handle for the other calls. */
  open(path: string): Promise<number>;
  /**
   * Sends one 32-byte report and resolves with the reply to it. Rejects with
   * TransportTimeoutError or DeviceDisconnectedError (or another Error).
   */
  request(handle: number, report: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  /**
   * Sends the reports back to back, each once the previous one is answered.
   * Rejects with BatchError (replies so far, and why the next failed).
   */
  requestMany(handle: number, reports: readonly Uint8Array[], timeoutMs: number): Promise<Uint8Array[]>;
  close(handle: number): Promise<void>;
  /** Called with the handle of an open device the host saw disappear; returns an unsubscribe function. */
  onDisconnect(cb: (handle: number) => void): () => void;
}

export class NativeHidTransport implements Transport {
  private readonly bridge: NativeHidBridge;
  private readonly device: NativeKeyboard;
  private readonly timeoutMs: number;
  private handle: number | null = null;
  private disconnected = false;
  private unlisten: (() => void) | null = null;
  private readonly disconnectListeners = new Set<() => void>();

  constructor(bridge: NativeHidBridge, device: NativeKeyboard, options: { timeoutMs?: number } = {}) {
    this.bridge = bridge;
    this.device = device;
    this.timeoutMs = options.timeoutMs ?? 500;
  }

  get info(): DeviceInfo {
    return {
      productName: this.device.productName,
      vendorId: this.device.vendorId,
      productId: this.device.productId,
    };
  }

  async open(): Promise<void> {
    if (this.handle !== null) return;
    // Listen first, so an unplug between opening and listening is not missed.
    this.unlisten = this.bridge.onDisconnect((handle) => {
      if (handle === this.handle) this.markDisconnected();
    });
    try {
      this.handle = await this.bridge.open(this.device.path);
    } catch (err) {
      this.unlisten();
      this.unlisten = null;
      throw err;
    }
  }

  async close(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    this.disconnected = true;
    const handle = this.handle;
    this.handle = null;
    if (handle !== null) await this.bridge.close(handle).catch(() => undefined);
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  send(report: Uint8Array): Promise<Uint8Array> {
    if (this.disconnected) return Promise.reject(new DeviceDisconnectedError());
    if (this.handle === null) return Promise.reject(new Error("the device is not open"));
    if (report.length !== MSG_LEN) {
      return Promise.reject(new Error(`reports must be ${MSG_LEN} bytes, got ${report.length}`));
    }
    return this.bridge.request(this.handle, report, this.timeoutMs).catch((err: unknown) => {
      if (err instanceof DeviceDisconnectedError) this.markDisconnected();
      throw err;
    });
  }

  sendMany(reports: readonly Uint8Array[]): Promise<Uint8Array[]> {
    if (this.disconnected) return Promise.reject(new DeviceDisconnectedError());
    if (this.handle === null) return Promise.reject(new Error("the device is not open"));
    const wrong = reports.find((r) => r.length !== MSG_LEN);
    if (wrong) return Promise.reject(new Error(`reports must be ${MSG_LEN} bytes, got ${wrong.length}`));
    return this.bridge.requestMany(this.handle, reports, this.timeoutMs).catch((err: unknown) => {
      const cause = err instanceof BatchError ? err.error : err;
      if (cause instanceof DeviceDisconnectedError) this.markDisconnected();
      throw err;
    });
  }

  private markDisconnected(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.unlisten?.();
    this.unlisten = null;
    for (const cb of this.disconnectListeners) cb();
  }
}
