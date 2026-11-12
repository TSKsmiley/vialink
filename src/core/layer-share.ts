// SPDX-License-Identifier: GPL-2.0-or-later
// A layer as one line of text, to send to a friend in any chat (design
// board 7). ViaLink-only; it never touches the .vil format or the wire.
//
//   vialink:layer:1:<slug>:<data>
//
// slug: the keyboard name in lower case, for people only, never matched.
// data: base64url (no padding) of deflate-raw compressed JSON:
//   { kb: [vendorId, productId, "<Vial keyboard uid, hex>"],
//     lo: [[label, choice name or 0/1], …],   layout options of the sender
//     name?: "Nav",                            layer name, if it has one
//     keys: [[row, col, "KC_A"], …],           keys that are not transparent
//     enc?: [[index, direction, "KC_VOLU"], …],
//     refs?: { macros: [3], tapDances: [0] } } macros/tap dances the keys use
// Keycodes are written as vial-gui names, so they survive firmware keycode
// renumbering. Matching on paste is by matrix position: same keyboard, same
// matrix, whatever the layout options.

import type { LayoutLabel } from "./definition/layoutOptions.ts";
import type { Keyboard } from "./keyboard.ts";
import { KC_TRNS, visiblePositions } from "./layerInfo.ts";
import type { LayerSnapshot } from "./layers.ts";

export const SHARE_PREFIX = "vialink:layer:";
/**
 * Format version written into every share text, right after the prefix.
 * Backwards compatibility: decodeLayer keeps one decoder per version it ever
 * wrote (DECODERS below), so texts from older ViaLinks keep working. A change
 * that old decoders cannot read (new required fields, other compression, a
 * different JSON shape) gets a new version and a new decoder next to the old
 * ones; never change what an existing version means. Optional JSON fields
 * that old decoders simply ignore may be added without a new version.
 */
export const SHARE_VERSION = 1;
/** A test keeps a worst-case KLOR layer under this, leaving room in a 2,000-character Discord message. */
export const SHARE_MAX_LENGTH = 1800;

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareError";
  }
}

interface ShareJson {
  kb: [number, number, string];
  lo: [string, string | number][];
  name?: string;
  keys: [number, number, string][];
  enc?: [number, 0 | 1, string][];
  refs?: { macros?: number[]; tapDances?: number[] };
}

export interface SharedLayer {
  slug: string;
  vendorId: number;
  productId: number;
  uid: bigint;
  /** Sender's layout options as [label, choice]. */
  layout: [string, string | number][];
  name: string | null;
  keys: { row: number; col: number; id: string }[];
  encoders: { index: number; direction: 0 | 1; id: string }[];
  macros: number[];
  tapDances: number[];
}

// ── bytes ───────────────────────────────────────────────────────────────────

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const out = input.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text))
    throw new ShareError("The text has characters a shared layer never has.");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ── layout options ─────────────────────────────────────────────────────────

function layoutOf(kb: Keyboard): [string, string | number][] {
  const labels: LayoutLabel[] = kb.layoutLabels ?? [];
  const choices = kb.layoutChoices;
  return labels.map((label, i) =>
    typeof label === "string"
      ? [label, choices[i] ?? 0]
      : [label[0], label[1 + (choices[i] ?? 0)] ?? choices[i] ?? 0],
  );
}

/** "Polydactyl" or "Split backspace on" for messages. */
export function describeLayout(layout: readonly [string, string | number][]): string {
  if (layout.length === 0) return "no layout options";
  return layout.map(([label, v]) => (typeof v === "string" ? v : `${label} ${v ? "on" : "off"}`)).join(", ");
}

// ── encode ──────────────────────────────────────────────────────────────────

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "keyboard";

/** The share text for one layer: every visible key that is not transparent, and its encoders. */
export async function encodeLayer(kb: Keyboard, layer: number, name: string | null): Promise<string> {
  const table = kb.keycodes;
  const keys: ShareJson["keys"] = [];
  const macros = new Set<number>();
  const tapDances = new Set<number>();
  const noteRefs = (id: string) => {
    const m = /^M(\d+)$/.exec(id);
    if (m) macros.add(Number(m[1]));
    const td = /^TD\((\d+)\)$/.exec(id);
    if (td) tapDances.add(Number(td[1]));
  };
  for (const p of visiblePositions(kb)) {
    const code = kb.getKey(layer, p.row, p.col);
    if (code === undefined || code === KC_TRNS) continue;
    const id = table.serialize(code);
    noteRefs(id);
    keys.push([p.row, p.col, id]);
  }
  const enc: NonNullable<ShareJson["enc"]> = [];
  for (const index of kb.encoderIndices) {
    for (const direction of [0, 1] as const) {
      const code = kb.getEncoder(layer, index, direction);
      if (code === undefined || code === KC_TRNS) continue;
      const id = table.serialize(code);
      noteRefs(id);
      enc.push([index, direction, id]);
    }
  }
  const info = kb.queue.transport.info;
  const json: ShareJson = {
    kb: [info.vendorId, info.productId, kb.uid.toString(16)],
    lo: layoutOf(kb),
    ...(name ? { name } : {}),
    keys,
    ...(enc.length ? { enc } : {}),
    ...(macros.size || tapDances.size
      ? {
          refs: {
            ...(macros.size ? { macros: [...macros].sort((a, b) => a - b) } : {}),
            ...(tapDances.size ? { tapDances: [...tapDances].sort((a, b) => a - b) } : {}),
          },
        }
      : {}),
  };
  const packed = await pipe(
    new TextEncoder().encode(JSON.stringify(json)),
    new CompressionStream("deflate-raw"),
  );
  return `${SHARE_PREFIX}${SHARE_VERSION}:${slugOf(kb.name)}:${toBase64Url(packed)}`;
}

// ── decode ──────────────────────────────────────────────────────────────────

/** True when the text looks like a shared layer (for Ctrl+V anywhere). */
export function isShareText(text: string): boolean {
  return text.trim().startsWith(SHARE_PREFIX);
}

const isInt = (v: unknown, max = 0xffff): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Reads share text; throws ShareError saying what is wrong. */
export async function decodeLayer(text: string): Promise<SharedLayer> {
  const t = text.trim();
  if (!t.startsWith(SHARE_PREFIX)) throw new ShareError("This is not a shared ViaLink layer.");
  const parts = t.slice(SHARE_PREFIX.length).split(":");
  if (parts.length !== 3) throw new ShareError("The text is not complete. Copy the whole line again.");
  const [versionText, slug, data] = parts;
  const version = /^[1-9][0-9]{0,3}$/.test(versionText) ? Number(versionText) : NaN;
  if (Number.isNaN(version)) throw new ShareError("This is not a shared ViaLink layer.");
  const decoder = DECODERS[version];
  if (!decoder) {
    throw new ShareError(
      `This layer was shared by a newer ViaLink (format ${version}). Update ViaLink and try again.`,
    );
  }
  return decoder(slug, data);
}

/** One decoder per format version ever written; see SHARE_VERSION. */
const DECODERS: Record<number, (slug: string, data: string) => Promise<SharedLayer>> = {
  1: decodeV1,
};

/** Format 1: base64url of deflate-raw JSON (ShareJson). */
async function decodeV1(slug: string, data: string): Promise<SharedLayer> {
  let json: ShareJson;
  try {
    const raw = await pipe(fromBase64Url(data), new DecompressionStream("deflate-raw"));
    json = JSON.parse(new TextDecoder().decode(raw)) as ShareJson;
  } catch (err) {
    if (err instanceof ShareError) throw err;
    throw new ShareError("The text was cut off or changed. Copy the whole line again.");
  }
  const bad = () => new ShareError("The shared layer is damaged.");
  if (!json || typeof json !== "object" || !Array.isArray(json.kb) || !Array.isArray(json.keys)) throw bad();
  const [vendorId, productId, uid] = json.kb;
  if (!isInt(vendorId) || !isInt(productId) || typeof uid !== "string" || !/^[0-9a-f]{1,16}$/.test(uid))
    throw bad();
  const keys = json.keys.map((k) => {
    if (!Array.isArray(k) || !isInt(k[0], 255) || !isInt(k[1], 255) || typeof k[2] !== "string") throw bad();
    return { row: k[0], col: k[1], id: k[2] };
  });
  const encoders = (json.enc ?? []).map((e) => {
    if (!Array.isArray(e) || !isInt(e[0], 255) || (e[1] !== 0 && e[1] !== 1) || typeof e[2] !== "string")
      throw bad();
    return { index: e[0], direction: e[1], id: e[2] };
  });
  const ints = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => isInt(n)) : []);
  return {
    slug,
    vendorId,
    productId,
    uid: BigInt(`0x${uid}`),
    layout: Array.isArray(json.lo)
      ? json.lo.filter(
          (x): x is [string, string | number] =>
            Array.isArray(x) && typeof x[0] === "string" && (typeof x[1] === "string" || isInt(x[1])),
        )
      : [],
    name: typeof json.name === "string" ? json.name : null,
    keys,
    encoders,
    macros: ints(json.refs?.macros),
    tapDances: ints(json.refs?.tapDances),
  };
}

// ── match against the receiving keyboard ───────────────────────────────────

export interface ShareMatch {
  /** Every visible key of the receiver: the shared key, or transparent where the text has none. */
  snapshot: LayerSnapshot;
  /** Shared keys whose matrix position is not on the receiver's chosen layout. */
  unplaced: { row: number; col: number; code: number }[];
  /** Keycodes this firmware does not know; left out. */
  unknown: string[];
  sameLayout: boolean;
  /** Macros and tap dances the keys use that are empty on this keyboard. */
  emptyMacros: number[];
  emptyTapDances: number[];
}

/**
 * Maps a shared layer onto this keyboard by matrix position. Refuses text
 * from another keyboard (USB id or Vial keyboard uid differ).
 */
export function matchShared(
  kb: Keyboard,
  shared: SharedLayer,
  state: { macroEmpty?: (n: number) => boolean; tapDanceEmpty?: (n: number) => boolean } = {},
): ShareMatch {
  const info = kb.queue.transport.info;
  if (shared.vendorId !== info.vendorId || shared.productId !== info.productId || shared.uid !== kb.uid) {
    throw new ShareError(
      `This layer is for another keyboard (${shared.slug}). It can only be pasted onto the same kind of keyboard.`,
    );
  }
  const table = kb.keycodes;
  const visible = new Set(visiblePositions(kb).map((p) => `${p.row},${p.col}`));
  const keys = new Map<string, number>();
  for (const id of visible) keys.set(id, KC_TRNS);
  const unplaced: ShareMatch["unplaced"] = [];
  const unknown: string[] = [];
  const parse = (id: string): number | null => {
    try {
      return table.parse(id);
    } catch {
      unknown.push(id);
      return null;
    }
  };
  for (const k of shared.keys) {
    const code = parse(k.id);
    if (code === null) continue;
    const id = `${k.row},${k.col}`;
    if (visible.has(id)) keys.set(id, code);
    else unplaced.push({ row: k.row, col: k.col, code });
  }
  const encoders = new Map<string, number>();
  const indices = new Set(kb.encoderIndices);
  for (const e of shared.encoders) {
    if (!indices.has(e.index)) continue;
    const code = parse(e.id);
    if (code !== null) encoders.set(`${e.index},${e.direction}`, code);
  }
  const mine = layoutOf(kb);
  const sameLayout = JSON.stringify(mine) === JSON.stringify(shared.layout);
  return {
    snapshot: { layer: null, keys, encoders },
    unplaced,
    unknown,
    sameLayout,
    emptyMacros: shared.macros.filter((n) => state.macroEmpty?.(n) ?? false),
    emptyTapDances: shared.tapDances.filter((n) => state.tapDanceEmpty?.(n) ?? false),
  };
}

export { layoutOf as layoutOptionsOf };
