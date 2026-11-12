// SPDX-License-Identifier: GPL-2.0-only
// WebHID transport. The reply-sequence tracking is adapted from Vialite's
// src/protocol/transport.ts (https://github.com/tcyeee/vialite, GPL-2.0);
// retries and serialization live in RequestQueue instead of here.
// Modified for ViaLink, November 2026.
//
// Report ID convention (same as Vialite and vial-web): the board uses report
// ID 0, and sendReport(0, payload) / event.data carry the bare 32-byte
// VIA/Vial message with no report-ID byte inside it.

import {
  DeviceDisconnectedError,
  MSG_LEN,
  TransportTimeoutError,
  type DeviceInfo,
  type Transport,
} from "./types.ts";

interface Waiter {
  /** Sequence number of the report whose reply this waiter wants. */
  seq: number;
  resolve: (data: Uint8Array) => void;
  reject: (err: Error) => void;
}

export class WebHidTransport implements Transport {
  private readonly device: HIDDevice;
  private readonly timeoutMs: number;
  private waiter: Waiter | null = null;
  // The board answers each report once, in order, so reply N belongs to
  // report N. Counting both lets a late reply to a timed-out report be
  // dropped instead of being taken as the next command's answer.
  private sentCount = 0;
  private recvCount = 0;
  private disconnected = false;
  private readonly disconnectListeners = new Set<() => void>();

  constructor(device: HIDDevice, options: { timeoutMs?: number } = {}) {
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
    if (!this.device.opened) {
      await this.device.open();
    }
    this.device.addEventListener("inputreport", this.handleInputReport);
    navigator.hid.addEventListener("disconnect", this.handleDisconnect);
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.handleInputReport);
    navigator.hid.removeEventListener("disconnect", this.handleDisconnect);
    this.failWaiter(new DeviceDisconnectedError("the connection was closed"));
    this.disconnected = true;
    if (this.device.opened) {
      await this.device.close();
    }
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  send(report: Uint8Array): Promise<Uint8Array> {
    if (this.disconnected) {
      return Promise.reject(new DeviceDisconnectedError());
    }
    if (report.length !== MSG_LEN) {
      return Promise.reject(new Error(`reports must be ${MSG_LEN} bytes, got ${report.length}`));
    }
    // Replies can only overtake reports if something unsolicited arrived;
    // realign so the next sequence check can succeed.
    if (this.recvCount > this.sentCount) {
      this.recvCount = this.sentCount;
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter === waiter) this.waiter = null;
        reject(new TransportTimeoutError());
      }, this.timeoutMs);
      const waiter: Waiter = {
        seq: this.sentCount + 1,
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.waiter = waiter;
      this.sentCount += 1;
      // Copy into a fresh ArrayBuffer-backed array; WebHID rejects shared or offset views on some builds.
      this.device.sendReport(0, new Uint8Array(report)).catch((err: unknown) => {
        // The report never reached the device, so no reply will come for it.
        this.sentCount -= 1;
        if (this.waiter === waiter) this.waiter = null;
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleInputReport = (event: HIDInputReportEvent): void => {
    const data = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    this.recvCount += 1;
    const waiter = this.waiter;
    if (waiter && waiter.seq === this.recvCount) {
      this.waiter = null;
      waiter.resolve(data);
    }
    // Otherwise it is a late reply to a report that already timed out: drop it.
  };

  private handleDisconnect = (event: HIDConnectionEvent): void => {
    if (event.device !== this.device) return;
    this.disconnected = true;
    navigator.hid.removeEventListener("disconnect", this.handleDisconnect);
    this.device.removeEventListener("inputreport", this.handleInputReport);
    this.failWaiter(new DeviceDisconnectedError());
    for (const cb of this.disconnectListeners) cb();
  };

  private failWaiter(err: Error): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(err);
  }
}
