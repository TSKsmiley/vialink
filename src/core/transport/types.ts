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

export class DeviceDisconnectedError extends Error {
  constructor(message = "the device is disconnected") {
    super(message);
    this.name = "DeviceDisconnectedError";
  }
}
