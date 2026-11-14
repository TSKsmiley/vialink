// SPDX-License-Identifier: GPL-2.0-or-later
// What else changes when an extension is switched on or off in the
// Extensions dialog, and the question that asks about it. ViaLink-only.
//
// Rule (user, 13 Nov): ask whenever the switch would change something else.
// - On: requirements that are switched off are turned on too; a conflicting
//   extension that runs on the connected keyboard is turned off, with the
//   extensions that need it. A conflict with one that doesn't run on this
//   keyboard changes nothing here, so it isn't asked about; the switches are
//   defaults and each keyboard settles it by the most recent turn-on.
// - Off: switched-on extensions that require it are turned off too.
// No → nothing changes.

import { conflicting, requiredBy, requirementsOf } from "../../core/extensions/manifest.ts";
import type { KeyboardExtension } from "../../core/extensions/types.ts";
import type { Keyboard } from "../../core/keyboard.ts";

type Ext = KeyboardExtension<unknown>;

export interface SwitchChange {
  readonly id: string;
  readonly on: boolean;
}

export interface SwitchPlan {
  /** Every switch that changes, the clicked one first. */
  readonly changes: readonly SwitchChange[];
  /** What to ask before changing more than the clicked switch; null when nothing else changes. */
  readonly question: string | null;
}

/** "A", "A and B", "A, B and C". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const nameOf = (all: readonly Ext[], id: string) => all.find((e) => e.id === id)?.name ?? id;

/**
 * Plans switching `target` on.
 * @param running whether an extension runs on the connected keyboard (always false with none)
 * @param supported whether the keyboard supports an extension (true with none connected)
 */
export function planTurnOn(
  target: Ext,
  all: readonly Ext[],
  disabled: ReadonlySet<string>,
  running: (id: string) => boolean,
  supported: (id: string) => boolean,
): SwitchPlan {
  const alsoOn = requirementsOf(target.id, all).filter((e) => disabled.has(e.id));
  const turningOn = [target, ...alsoOn];
  // A conflict only changes something when the new extension (and what it needs) would run here.
  const willRun = (ext: Ext) =>
    supported(ext.id) && requirementsOf(ext.id, all).every((req) => supported(req.id));
  const pairs: [Ext, Ext][] = [];
  for (const other of all) {
    if (disabled.has(other.id) || !running(other.id)) continue;
    const by = turningOn.find((t) => willRun(t) && conflicting(t, other));
    if (by) pairs.push([by, other]);
  }
  const conflictsOff = pairs.map(([, other]) => other);
  const offIds = new Set(conflictsOff.map((e) => e.id));
  const dependentsOff: Ext[] = [];
  for (const loser of conflictsOff) {
    for (const dep of requiredBy(loser.id, all)) {
      if (!disabled.has(dep.id) && !offIds.has(dep.id) && !turningOn.includes(dep)) {
        offIds.add(dep.id);
        dependentsOff.push(dep);
      }
    }
  }

  const changes: SwitchChange[] = [
    ...turningOn.map((e) => ({ id: e.id, on: true })),
    ...[...offIds].map((id) => ({ id, on: false })),
  ];
  if (alsoOn.length === 0 && offIds.size === 0) return { changes, question: null };

  const names = (exts: readonly Ext[]) => nameList(exts.map((e) => e.name));
  const lines: string[] = [];
  if (alsoOn.length > 0) lines.push(`${target.name} needs ${names(alsoOn)}.`);
  for (const [by, other] of pairs) lines.push(`${by.name} doesn't work with ${other.name}.`);
  if (dependentsOff.length > 0) {
    lines.push(
      `${names(dependentsOff)} ${dependentsOff.length === 1 ? "needs" : "need"} ${names(conflictsOff)}.`,
    );
  }
  const offNames = nameList([...offIds].map((id) => nameOf(all, id)));
  const ask =
    alsoOn.length > 0 && offIds.size > 0
      ? `Turn ${names(alsoOn)} on and ${offNames} off?`
      : alsoOn.length > 0
        ? `Turn ${names(alsoOn)} on too?`
        : `Turn ${offNames} off?`;
  return { changes, question: [...lines, ask].join(" ") };
}

/** Plans switching `target` off. */
export function planTurnOff(target: Ext, all: readonly Ext[], disabled: ReadonlySet<string>): SwitchPlan {
  const alsoOff = requiredBy(target.id, all).filter((e) => !disabled.has(e.id));
  const changes = [target, ...alsoOff].map((e) => ({ id: e.id, on: false }));
  if (alsoOff.length === 0) return { changes, question: null };
  const names = nameList(alsoOff.map((e) => e.name));
  const verb = alsoOff.length === 1 ? "needs" : "need";
  return { changes, question: `${names} ${verb} ${target.name}. Turn ${names} off too?` };
}

/**
 * Plans switching `target` on for the connected keyboard (or none): asks the
 * keyboard whether the extensions that would clash with a running one are
 * supported, since a conflict only changes something when they would run.
 * Used by the Extensions dialog and the layout-file load dialog.
 */
export async function planTurnOnFor(
  keyboard: Keyboard | null,
  target: Ext,
  all: readonly Ext[],
  disabled: ReadonlySet<string>,
): Promise<SwitchPlan> {
  const running = new Set(keyboard?.activeExtensions.map((a) => a.extension.id) ?? []);
  const support = new Map<string, boolean>();
  if (keyboard) {
    const turningOn = [target, ...requirementsOf(target.id, all)];
    const clashes = turningOn.filter((t) => all.some((o) => running.has(o.id) && conflicting(t, o)));
    for (const t of clashes) {
      for (const e of [t, ...requirementsOf(t.id, all)]) {
        if (!support.has(e.id)) support.set(e.id, await keyboard.supportsExtension(e));
      }
    }
  }
  return planTurnOn(
    target,
    all,
    disabled,
    (id) => running.has(id),
    (id) => support.get(id) ?? true,
  );
}

/** The switched-off set after `changes`. */
export function switchedOff(disabled: ReadonlySet<string>, changes: readonly SwitchChange[]): Set<string> {
  const next = new Set(disabled);
  for (const { id, on } of changes) {
    if (on) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** `changes` as the keyboard's setExtensionsEnabled takes them (unknown ids left out). */
export function switchesFor(
  changes: readonly SwitchChange[],
  all: readonly Ext[],
): { extension: Ext; enabled: boolean }[] {
  return changes.flatMap(({ id, on }) => {
    const extension = all.find((e) => e.id === id);
    return extension ? [{ extension, enabled: on }] : [];
  });
}
