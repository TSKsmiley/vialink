// SPDX-License-Identifier: GPL-2.0-or-later
// Small byte helpers shared by the protocol modules. VIA fields are big-endian,
// Vial fields little-endian; every reader names its byte order explicitly.

export function u16be(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

export function u32be(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
}

export function u16le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

export function u32le(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

export function u64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

/** Builds a byte array from a mix of single bytes and pre-encoded chunks. */
export function bytes(...parts: (number | Uint8Array | number[])[]): Uint8Array {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") {
      flat.push(part & 0xff);
    } else {
      for (const b of part) flat.push(b & 0xff);
    }
  }
  return Uint8Array.from(flat);
}

export function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

export function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Lower-case hex without separators, e.g. "fe0012". */
export function toHex(data: Uint8Array): string {
  let out = "";
  for (const b of data) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Right-pads (never truncates) to `length` with zero bytes. */
export function padTo(data: Uint8Array, length: number): Uint8Array {
  if (data.length >= length) return data;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
}

/** Hex with trailing zero bytes removed; used to keep traces readable. */
export function toTrimmedHex(data: Uint8Array): string {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  return toHex(data.subarray(0, end));
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
