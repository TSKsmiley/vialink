// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency part of an extension's manifest (requires, optional,
// provides, conflicts): load order, cycle checks and which enabled extensions
// run on a keyboard. ViaLink-only; vial-gui has no extensions. Pure functions,
// so the Keyboard (probing) and the Extensions dialog (questions) share them.
//
// Decisions (plan doc, Extension API tab, 13 Nov):
// - The on/off switches are per browser and act as defaults; what runs on a
//   keyboard also depends on what that keyboard supports.
// - A requirement that is off, unsupported or not running keeps the extension
//   off on this keyboard ("Needs …").
// - Two conflicting extensions that both run on a keyboard: the one turned on
//   by hand most recently wins; when neither was, the one already there (the
//   one that doesn't declare the conflict) wins, then the earlier in the registry.

import { isStandardCommand } from "../protocol/standard.ts";
import { isCoreService } from "./services.ts";
import type { KeyboardExtension } from "./types.ts";

/** Something an extension offers others: a service or a hook point. Ids start with the owner's id. */
export interface ExtensionPoint {
  readonly id: string;
}

/** Why an extension does or does not run on the connected keyboard. */
export type ExtensionStatus =
  | { readonly kind: "active" }
  /** Switched off in the Extensions dialog. */
  | { readonly kind: "off" }
  /** The keyboard's firmware lacks it (the probe said no). */
  | { readonly kind: "unsupported" }
  /** A required extension doesn't run on this keyboard. */
  | { readonly kind: "needs"; readonly ids: readonly string[] }
  /** A conflicting extension runs instead. */
  | { readonly kind: "conflict"; readonly with: string };

type Ext = KeyboardExtension<unknown>;

const requiresOf = (ext: Ext) => ext.requires ?? [];
const dependsOn = (ext: Ext) => [...(ext.requires ?? []), ...(ext.optional ?? [])];

/** True when either of the two declares a conflict with the other. */
export function conflicting(a: Ext, b: Ext): boolean {
  return (a.conflicts ?? []).includes(b.id) || (b.conflicts ?? []).includes(a.id);
}

/**
 * A cycle of requires/optional among `exts` as a list of ids that starts and
 * ends with the same id, or null when there is none.
 */
export function findCycle(exts: readonly Ext[]): string[] | null {
  const byId = new Map(exts.map((e) => [e.id, e]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const dep of dependsOn(byId.get(id)!)) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const ext of exts) {
    const cycle = visit(ext.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * `exts` with every extension after the ones it requires or optionally uses
 * (those present in `exts`), otherwise in the given order. Throws on a cycle,
 * which the registry test rules out for the built-in extensions.
 */
export function dependencyOrder<E extends Ext>(exts: readonly E[]): E[] {
  const cycle = findCycle(exts);
  if (cycle) throw new Error(`Extension dependency cycle: ${cycle.join(" → ")}`);
  const byId = new Map(exts.map((e) => [e.id, e]));
  const placed = new Set<string>();
  const out: E[] = [];
  const place = (ext: E) => {
    if (placed.has(ext.id)) return;
    placed.add(ext.id);
    for (const dep of dependsOn(ext)) {
      const found = byId.get(dep);
      if (found) place(found);
    }
    out.push(ext);
  };
  for (const ext of exts) place(ext);
  return out;
}

/** Problems with a set of extensions' manifests; empty when they are fine. */
export function manifestProblems(exts: readonly Ext[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const ext of exts) {
    if (ids.has(ext.id)) problems.push(`Two extensions have the id "${ext.id}".`);
    ids.add(ext.id);
  }
  const points = new Set<string>();
  for (const ext of exts) {
    const lists = { requires: ext.requires, optional: ext.optional, conflicts: ext.conflicts };
    for (const [field, list] of Object.entries(lists)) {
      for (const id of list ?? []) {
        if (id === ext.id) problems.push(`${ext.id}: ${field} names itself.`);
        else if (!ids.has(id)) problems.push(`${ext.id}: ${field} names unknown extension "${id}".`);
      }
    }
    for (const id of ext.requires ?? []) {
      if ((ext.conflicts ?? []).includes(id))
        problems.push(`${ext.id}: both requires and conflicts with "${id}".`);
    }
    for (const point of ext.provides ?? []) {
      // Core services ("core.…") may have several providers; an extension's own points have one.
      if (isCoreService(point.id)) continue;
      if (!point.id.startsWith(`${ext.id}.`)) {
        problems.push(`${ext.id}: provided "${point.id}" must start with "${ext.id}." or "core.".`);
      }
      if (points.has(point.id)) problems.push(`"${point.id}" is provided twice.`);
      points.add(point.id);
    }
  }
  for (const ext of exts) {
    if (!!ext.layoutFile !== (ext.saves === "layout-file")) {
      problems.push(`${ext.id}: a layoutFile section and saves: "layout-file" go together.`);
    }
  }
  // Handling another extension's hook point means depending on it (requires or optional).
  for (const ext of exts) {
    const deps = [...(ext.requires ?? []), ...(ext.optional ?? [])];
    for (const handler of ext.hooks ?? []) {
      const owner = handler.hook.slice(0, handler.hook.indexOf("."));
      if (ids.has(owner) && owner !== ext.id && !deps.includes(owner)) {
        problems.push(
          `${ext.id}: handles ${handler.hook} without listing "${owner}" in requires or optional.`,
        );
      }
    }
  }
  for (const ext of exts) {
    if (ext.group !== "nonstandard") continue;
    if (ext.commands.length === 0) problems.push(`${ext.id}: non-standard but declares no custom commands.`);
    for (const command of ext.commands) {
      if (isStandardCommand(new Uint8Array([...command.bytes, 0, 0, 0]))) {
        problems.push(`${ext.id}: "${command.name}" is a standard Vial command; don't declare it.`);
      }
    }
  }
  const cycle = findCycle(exts);
  if (cycle) problems.push(`Dependency cycle: ${cycle.join(" → ")}.`);
  return problems;
}

/** Every extension in `all` that requires `id`, directly or through others. */
export function requiredBy(id: string, all: readonly Ext[]): Ext[] {
  const out = new Map<string, Ext>();
  const visit = (target: string) => {
    for (const ext of all) {
      if (!out.has(ext.id) && requiresOf(ext).includes(target)) {
        out.set(ext.id, ext);
        visit(ext.id);
      }
    }
  };
  visit(id);
  return [...out.values()];
}

/** Every extension in `all` that `id` requires, directly or through others. */
export function requirementsOf(id: string, all: readonly Ext[]): Ext[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const out = new Map<string, Ext>();
  const visit = (target: string) => {
    const ext = byId.get(target);
    if (!ext) return;
    for (const dep of requiresOf(ext)) {
      const found = byId.get(dep);
      if (found && !out.has(dep)) {
        out.set(dep, found);
        visit(dep);
      }
    }
  };
  visit(id);
  return [...out.values()];
}

/**
 * Decides which of the enabled extensions run on a keyboard.
 *
 * @param enabled  switched-on extensions, in {@link dependencyOrder}
 * @param supported whether the keyboard supports an extension (its probe said yes)
 * @param recency  when an extension was last turned on by hand (higher is more
 *                 recent; 0 when never), to settle conflicts
 * @returns a status for every enabled extension
 */
export function resolveActive(
  enabled: readonly Ext[],
  supported: (id: string) => boolean,
  recency: (id: string) => number = () => 0,
): Map<string, ExtensionStatus> {
  const status = new Map<string, ExtensionStatus>();
  const missing = (ext: Ext, running: ReadonlySet<string>) =>
    requiresOf(ext).filter((id) => !running.has(id));

  // 1. Supported, with every requirement supported too (dependency order makes one pass enough).
  const candidates = new Set<string>();
  for (const ext of enabled) {
    const needs = missing(ext, candidates);
    if (needs.length > 0) status.set(ext.id, { kind: "needs", ids: needs });
    else if (!supported(ext.id)) status.set(ext.id, { kind: "unsupported" });
    else candidates.add(ext.id);
  }

  // 2. Conflicts: preferred candidates first; one that conflicts with an accepted one loses.
  const pool = enabled.filter((e) => candidates.has(e.id));
  const declares = (ext: Ext) => pool.some((other) => (ext.conflicts ?? []).includes(other.id));
  const ranked = pool
    .map((ext, index) => ({ ext, index }))
    .sort(
      (a, b) =>
        recency(b.ext.id) - recency(a.ext.id) ||
        Number(declares(a.ext)) - Number(declares(b.ext)) ||
        a.index - b.index,
    );
  const accepted: Ext[] = [];
  for (const { ext } of ranked) {
    const winner = accepted.find((other) => conflicting(ext, other));
    if (winner) status.set(ext.id, { kind: "conflict", with: winner.id });
    else accepted.push(ext);
  }

  // 3. A loser can take a requirement with it.
  const running = new Set<string>();
  for (const ext of pool) {
    if (status.has(ext.id)) continue;
    const needs = missing(ext, running);
    if (needs.length > 0) status.set(ext.id, { kind: "needs", ids: needs });
    else {
      running.add(ext.id);
      status.set(ext.id, { kind: "active" });
    }
  }
  return status;
}
