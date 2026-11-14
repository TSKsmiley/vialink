// SPDX-License-Identifier: GPL-2.0-or-later

/** Every VIA/Vial raw-HID report is exactly this long, in both directions. */
export const MSG_LEN = 32;

export interface DeviceInfo {
  productName: string;
  vendorId: number;
  productId: number;
}

/**
 * The only code that touches a device. Everything above it (queue, commands,
 * keyboard) is pure and can run against a recorded trace instead.
 */
export interface Transport {
  readonly info: DeviceInfo;
  open(): Promise<void>;
  /**
   * Sends one 32-byte report and resolves with the 32-byte reply to it.
   * Rejects with {@link TransportTimeoutError} when no reply arrives in time,
   * and with {@link DeviceDisconnectedError} once the device is gone.
   */
  send(report: Uint8Array): Promise<Uint8Array>;
  /**
   * Optional: sends the reports one after another, each once the previous one
   * is answered, and resolves with the replies in order. For a host that owns
   * the device (the desktop app): it sends them back to back instead of one
   * round trip through the page per report, so each fits its USB frame.
   * Rejects with {@link BatchError} when one fails, carrying the replies
   * received before it. Transports without it get the reports one by one.
   */
  sendMany?(reports: readonly Uint8Array[]): Promise<Uint8Array[]>;
  close(): Promise<void>;
  /** Registers a callback for an unplug; returns an unsubscribe function. */
  onDisconnect(cb: () => void): () => void;
}

export class TransportTimeoutError extends Error {
  constructor(message = "the device did not reply in time") {
    super(message);
    this.name = "TransportTimeoutError";
  }
}

/** A {@link Transport.sendMany} that failed partway: `replies` answer the first reports, `error` is why the next failed. */
export class BatchError extends Error {
  readonly error: Error;
  readonly replies: Uint8Array[];

  constructor(error: Error, replies: Uint8Array[]) {
    super(error.message);
    this.name = "BatchError";
    this.error = error;
    this.replies = replies;
  }
}

export class DeviceDisconnectedError extends Error {
  constructor(message = "the device is disconnected") {
    super(message);
    this.name = "DeviceDisconnectedError";
  }
}
