// SPDX-License-Identifier: GPL-2.0-or-later
// The keyboard's vial.json: fetched page by page, XZ-decompressed, validated,
// and turned into physical keys and encoders. Follows vial-gui's
// keyboard_comm.py::reload_layout; the XZ reader is adapted from Vialite's
// keyboard.ts (https://github.com/tcyeee/vialite, GPL-2.0).

import xz from "xz-decompress";
import { vialGetDefinitionPage, vialGetDefinitionSize } from "../protocol/commands.ts";
import type { RequestQueue } from "../transport/queue.ts";
import { MSG_LEN } from "../transport/types.ts";
import { concat } from "../util/bytes.ts";
import { deserializeKle, type KleData } from "./kle.ts";
import type { LayoutLabel } from "./layoutOptions.ts";

export interface CustomKeycode {
  name?: string;
  title?: string;
  shortName?: string;
}

export interface VialDefinition {
  name?: string;
  matrix: { rows: number; cols: number };
  layouts: { keymap: KleData; labels?: LayoutLabel[] };
  customKeycodes?: CustomKeycode[];
  /** "none" | "qmk_backlight" | "qmk_rgblight" | "qmk_backlight_rgblight" | "vialrgb" */
  lighting?: string;
  vial?: { vibl?: boolean; midi?: "basic" | "advanced" };
  [key: string]: unknown;
}

/** Geometry shared by keys and encoders, in KLE units (1 = one key width). */
export interface PhysicalShape {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationAngle: number;
  rotationX: number;
  rotationY: number;
  /** Layout option this shape belongs to; -1 means always shown. */
  layoutIndex: number;
  layoutOption: number;
}

export interface PhysicalKey extends PhysicalShape {
  row: number;
  col: number;
  x2: number;
  y2: number;
  width2: number;
  height2: number;
}

/** One rotation direction of one encoder. */
export interface PhysicalEncoder extends PhysicalShape {
  index: number;
  /** 0 = counter-clockwise, 1 = clockwise. */
  direction: 0 | 1;
}

export interface PhysicalLayout {
  keys: PhysicalKey[];
  encoders: PhysicalEncoder[];
  /** Number of encoders: highest index + 1, as vial-gui counts them. */
  encoderCount: number;
}

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitionError";
  }
}

/** Reads the compressed definition from the keyboard (CMD_VIAL_GET_SIZE, then GET_DEFINITION pages). */
export async function fetchCompressedDefinition(
  queue: RequestQueue,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const size = vialGetDefinitionSize.decode(await queue.request(vialGetDefinitionSize.encode()));
  if (size === 0 || size > 1024 * 1024) {
    throw new DefinitionError(`keyboard reported an implausible definition size of ${size} bytes`);
  }
  const pages = Math.ceil(size / MSG_LEN);
  const chunks: Uint8Array[] = [];
  let remaining = size;
  for (let page = 0; page < pages; page++) {
    const data = vialGetDefinitionPage.decode(await queue.request(vialGetDefinitionPage.encode(page)));
    chunks.push(remaining < MSG_LEN ? data.slice(0, remaining) : data);
    remaining -= MSG_LEN;
    onProgress?.(page + 1, pages);
  }
  return concat(chunks);
}

/** Decompresses an .xz stream (what Python's lzma.compress produces). */
export async function decompressXz(data: Uint8Array): Promise<Uint8Array> {
  // Read the stream directly rather than through `new Response(stream)`: an
  // error mid-stream would otherwise surface as an opaque "Failed to fetch".
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  const reader = new xz.XzReadableStream(stream).getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concat(chunks);
}

export async function decodeDefinition(compressed: Uint8Array): Promise<VialDefinition> {
  const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
  if (!XZ_MAGIC.every((b, i) => compressed[i] === b)) {
    throw new DefinitionError("keyboard definition is not XZ-compressed (bad magic bytes)");
  }
  let text: string;
  try {
    text = new TextDecoder().decode(await decompressXz(compressed));
  } catch (err) {
    throw new DefinitionError(`could not decompress the keyboard definition: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DefinitionError("keyboard definition is not valid JSON");
  }
  return validateDefinition(json);
}

export function validateDefinition(json: unknown): VialDefinition {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new DefinitionError("keyboard definition must be a JSON object");
  }
  const def = json as Record<string, unknown>;
  const matrix = def.matrix as Record<string, unknown> | undefined;
  if (!matrix || !isCount(matrix.rows) || !isCount(matrix.cols)) {
    throw new DefinitionError('keyboard definition needs "matrix": {"rows": n, "cols": n}');
  }
  const layouts = def.layouts as Record<string, unknown> | undefined;
  if (!layouts || !Array.isArray(layouts.keymap)) {
    throw new DefinitionError('keyboard definition needs "layouts": {"keymap": [...]}');
  }
  if (layouts.labels !== undefined) {
    const ok =
      Array.isArray(layouts.labels) &&
      layouts.labels.every(
        (l) =>
          typeof l === "string" ||
          (Array.isArray(l) && l.length > 0 && l.every((s) => typeof s === "string")),
      );
    if (!ok) throw new DefinitionError('"layouts.labels" must be strings or [title, ...choices] arrays');
  }
  if (def.customKeycodes !== undefined && !Array.isArray(def.customKeycodes)) {
    throw new DefinitionError('"customKeycodes" must be an array');
  }
  return def as VialDefinition;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 255;
}

/**
 * Extracts keys and encoders, as keyboard_comm.py::reload_layout does:
 * - labels[4] === "e": one direction of an encoder, labels[0] = "index,direction";
 * - labels[0] = "row,col": a key in the matrix;
 * - labels[8] = "index,option": the layout option the shape belongs to.
 * Decals are skipped. (vial-gui keeps them at matrix 0,0 but never draws
 * them; Vialite drops them. Dropping avoids aliasing a logo onto key 0,0.)
 */
export function extractPhysicalLayout(def: VialDefinition): PhysicalLayout {
  const keys: PhysicalKey[] = [];
  const encoders: PhysicalEncoder[] = [];
  let encoderCount = 0;
  const { rows, cols } = def.matrix;

  for (const k of deserializeKle(def.layouts.keymap)) {
    let layoutIndex = -1;
    let layoutOption = -1;
    if (k.labels[8]) {
      [layoutIndex, layoutOption] = parsePair(k.labels[8], "layout option");
    }
    const shape: PhysicalShape = {
      x: k.x,
      y: k.y,
      width: k.width,
      height: k.height,
      rotationAngle: k.rotationAngle,
      rotationX: k.rotationX,
      rotationY: k.rotationY,
      layoutIndex,
      layoutOption,
    };
    if (k.labels[4] === "e") {
      const [index, direction] = parsePair(k.labels[0] ?? "", "encoder");
      encoders.push({ ...shape, index, direction: direction === 1 ? 1 : 0 });
      encoderCount = Math.max(encoderCount, index + 1);
    } else if (!k.decal && k.labels[0]?.includes(",")) {
      const [row, col] = parsePair(k.labels[0], "matrix position");
      if (row >= rows || col >= cols) {
        throw new DefinitionError(
          `malformed vial.json: key references ${row},${col} but matrix declares rows=${rows} cols=${cols}`,
        );
      }
      keys.push({ ...shape, row, col, x2: k.x2, y2: k.y2, width2: k.width2, height2: k.height2 });
    }
  }
  return { keys, encoders, encoderCount };
}

function parsePair(text: string, what: string): [number, number] {
  const parts = text.split(",");
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (parts.length !== 2 || !Number.isInteger(a) || !Number.isInteger(b)) {
    throw new DefinitionError(`malformed ${what} label "${text}" in vial.json`);
  }
  return [a, b];
}
