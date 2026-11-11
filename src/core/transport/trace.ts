// SPDX-License-Identifier: GPL-2.0-or-later
// Recorded HID sessions. The debug panel exports one; ReplayTransport plays it
// back so a whole connect/edit/save flow can run in CI without a keyboard.

import { fromHex, padTo, toTrimmedHex } from "../util/bytes.ts";
import { MSG_LEN, type DeviceInfo } from "./types.ts";

export interface TraceExchange {
  /** Request report as hex, trailing zero bytes trimmed. */
  request: string;
  /** Reply report as hex, trailing zero bytes trimmed. */
  reply: string;
}

export interface Trace {
  format: "vial-ts-trace";
  version: 1;
  device: DeviceInfo;
  recordedAt: string;
  /** Free text, e.g. what was done during the recording. */
  note?: string;
  exchanges: TraceExchange[];
}

export function makeExchange(request: Uint8Array, reply: Uint8Array): TraceExchange {
  return { request: toTrimmedHex(request), reply: toTrimmedHex(reply) };
}

/** Decodes a trace hex field back into a full 32-byte report. */
export function reportFromHex(hex: string): Uint8Array {
  const data = fromHex(hex);
  if (data.length > MSG_LEN) {
    throw new Error(`trace report longer than ${MSG_LEN} bytes: ${hex}`);
  }
  return padTo(data, MSG_LEN);
}

export function parseTrace(text: string): Trace {
  const data = JSON.parse(text) as Partial<Trace>;
  if (data.format !== "vial-ts-trace" || data.version !== 1 || !Array.isArray(data.exchanges)) {
    throw new Error('not a vial-ts trace (expected format "vial-ts-trace", version 1)');
  }
  for (const ex of data.exchanges) {
    if (typeof ex?.request !== "string" || typeof ex?.reply !== "string") {
      throw new Error("malformed trace exchange");
    }
  }
  return data as Trace;
}
