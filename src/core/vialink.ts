// SPDX-License-Identifier: GPL-2.0-or-later
// The .vialink layout file: ViaLink's default save (plan doc, Extension API,
// "Layout files: .vialink by default, Vial by export"). ViaLink-only; desktop
// Vial reads .vil, which Export to Vial writes from the `vil` part.
//
//   { "vialink": 1,
//     "manifest": { "app": "0.1.0", "keyboard": "3a3c:0001", "extensions": { "layer-names": 1 } },
//     "vil": { …exactly what Export to Vial writes… },
//     "extensions": { "layer-names": { "v": 1, "names": ["Base", "Nav"] } } }
//
// Plain JSON (user, 13 Nov): readable, diffable, no extra library; the format
// number leaves room for a zip later. Each extension's section holds its own
// fields next to their data version "v", and its ctx.state ("layout") values
// under "state" (user, 13 Nov). Sections for extensions that are off or
// unknown are kept untouched and written back on the next save.

import type { Versioned } from "./extensions/state.ts";
import type { KeyboardExtension } from "./extensions/types.ts";
import type { Keyboard } from "./keyboard.ts";
import { parseVil, planVilRestore, saveVil, VilFormatError, type RestorePlan } from "./vil.ts";

/** The .vialink format number this ViaLink writes and the newest it reads. */
export const VIALINK_FORMAT = 1;

export interface VialinkFile {
  vialink: number;
  manifest: { app: string; keyboard: string; extensions: Record<string, number> };
  vil: Record<string, unknown>;
  extensions: Record<string, Record<string, unknown>>;
}

/** A layout file of either kind, as read. */
export type LayoutFile = { kind: "vialink"; file: VialinkFile } | { kind: "vil"; text: string };

/** What a load plan says beyond the writes. */
export interface LayoutRestorePlan extends RestorePlan {
  /** Sections whose extension is off or unknown, for the load summary. */
  notes: string[];
  /** Call once the plan was applied: keeps the sections nothing loaded for the next save. */
  afterApply(): void;
}

// Sections kept from the last loaded file for the next save, per keyboard.
const carried = new WeakMap<Keyboard, Record<string, Record<string, unknown>>>();

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

/** The keyboard's layout as a .vialink file (pretty JSON). */
export function saveVialink(kb: Keyboard, options: { app: string }): string {
  const sections: Record<string, Record<string, unknown>> = {};
  for (const { extension, state } of kb.activeExtensions) {
    if (extension.saves !== "layout-file" || !extension.layoutFile) continue;
    sections[extension.id] = { v: extension.layoutFile.version, ...extension.layoutFile.save(state) };
  }
  const states = kb.extensionLayoutState();
  for (const [id, values] of Object.entries(states)) {
    if (Object.keys(values).length === 0) continue;
    const ext = kb.activeExtensions.find((a) => a.extension.id === id)?.extension;
    sections[id] = { v: ext?.layoutFile?.version ?? 1, ...sections[id], state: values };
  }
  for (const [id, section] of Object.entries(carried.get(kb) ?? {})) {
    if (!(id in sections)) sections[id] = section;
  }
  const info = kb.queue.transport.info;
  const file: VialinkFile = {
    vialink: VIALINK_FORMAT,
    manifest: {
      app: options.app,
      keyboard: `${hex4(info.vendorId)}:${hex4(info.productId)}`,
      extensions: Object.fromEntries(Object.entries(sections).map(([id, s]) => [id, Number(s.v) || 1])),
    },
    vil: JSON.parse(saveVil(kb).replace(/"uid": (\d+)/, '"uid": "$1"')) as Record<string, unknown>,
    extensions: sections,
  };
  // The uid is a u64: kept as a JSON number, written from the BigInt, as in .vil.
  return JSON.stringify(file, null, 2).replace(/"uid": "(\d+)"/, '"uid": $1');
}

/** Reads a layout file of either kind; refuses a .vialink newer than this ViaLink. */
export function readLayoutFile(text: string): LayoutFile {
  let obj: unknown;
  try {
    // The uid is a u64: read it as a string so it keeps every digit.
    obj = JSON.parse(text.replace(/"uid":\s*(\d+)/, '"uid": "$1"'));
  } catch {
    throw new VilFormatError("This is not a layout file (it isn't JSON).");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || !("vialink" in obj))
    return { kind: "vil", text };
  const f = obj as Partial<VialinkFile>;
  if (typeof f.vialink !== "number" || !Number.isInteger(f.vialink) || f.vialink < 1) {
    throw new VilFormatError("This .vialink file has no valid format number.");
  }
  if (f.vialink > VIALINK_FORMAT) {
    throw new VilFormatError(
      `This .vialink file is format ${f.vialink}; this ViaLink reads up to format ${VIALINK_FORMAT}. Update ViaLink to load it.`,
    );
  }
  if (!f.vil || typeof f.vil !== "object")
    throw new VilFormatError("This .vialink file has no layout in it.");
  const extensions: Record<string, Record<string, unknown>> = {};
  for (const [id, section] of Object.entries(f.extensions ?? {})) {
    if (section && typeof section === "object" && !Array.isArray(section))
      extensions[id] = section as Record<string, unknown>;
  }
  return {
    kind: "vialink",
    file: {
      vialink: f.vialink,
      manifest: f.manifest ?? { app: "", keyboard: "", extensions: {} },
      vil: f.vil as Record<string, unknown>,
      extensions,
    },
  };
}

/**
 * Works out the writes a .vialink load makes: the Vial part as a .vil
 * restore, then each running extension's section (its restore steps and its
 * saved state). Sections of extensions that are off or unknown are noted and
 * kept for the next save.
 */
export function planLayoutRestore(
  kb: Keyboard,
  file: VialinkFile,
  known: readonly KeyboardExtension<unknown>[],
): LayoutRestorePlan {
  const vilText = JSON.stringify(file.vil).replace(/"uid":"(\d+)"/, '"uid":$1');
  const plan = planVilRestore(kb, parseVil(vilText));
  const notes: string[] = [];
  const keep: Record<string, Record<string, unknown>> = {};
  for (const [id, section] of Object.entries(file.extensions)) {
    const running = kb.activeExtensions.find((a) => a.extension.id === id);
    if (!running) {
      keep[id] = section;
      const ext = known.find((e) => e.id === id);
      notes.push(
        ext
          ? `Turn on ${ext.name} to load its data; it is kept for the next save.`
          : `Data from an extension this ViaLink doesn't know (${id}) is kept for the next save.`,
      );
      continue;
    }
    const { extension, state } = running;
    const { v, state: saved, ...fields } = section;
    if (extension.layoutFile) {
      for (const step of extension.layoutFile.restore(state, fields, Number(v) || 1)) {
        plan.ops.push({ kind: "extension", extensionId: id, ...step });
      }
    }
    if (saved && typeof saved === "object") {
      plan.ops.push({
        kind: "extension",
        extensionId: id,
        description: `Load ${extension.name}'s saved data`,
        apply: async () => kb.loadExtensionLayoutState(extension, saved as Record<string, Versioned>),
      });
    }
  }
  // Kept sections replace those of an earlier load, once this one is applied.
  return { ...plan, notes, afterApply: () => void carried.set(kb, keep) };
}

/** Names of the running extensions whose data Export to Vial leaves out, for its notice. */
export function leftOutOfVil(kb: Keyboard): string[] {
  const states = kb.extensionLayoutState();
  return kb.activeExtensions
    .filter(
      ({ extension }) =>
        (extension.saves === "layout-file" && extension.layoutFile) ||
        Object.keys(states[extension.id] ?? {}).length > 0,
    )
    .map(({ extension }) => extension.name);
}
