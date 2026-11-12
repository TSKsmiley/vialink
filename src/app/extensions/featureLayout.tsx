// SPDX-License-Identifier: GPL-2.0-or-later
// Shared layout of the feature views (design boards 2-4): a list of the
// entries that are set up on the left, the selected one in detail on the
// right, and helpers to say where an entry is placed in the keymap.

import { PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { visiblePositions } from "../../core/layerInfo.ts";
import { pickerInfoOf } from "../hooks.ts";

export interface EntryItem {
  id: number;
  title: string;
  /** "on 1 key", "not placed". */
  meta: string;
  summary: ReactNode;
}

export function FeatureLayout({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 md:max-w-[340px]">{list}</div>
      <div className="min-w-0 flex-[999_1_520px]">{detail}</div>
    </div>
  );
}

export function EntryList({
  title,
  used,
  description,
  items,
  selected,
  onSelect,
  newLabel,
  onNew,
  extra,
}: {
  title: string;
  used: string;
  description: string;
  items: readonly EntryItem[];
  selected: number | null;
  onSelect: (id: number) => void;
  newLabel: string;
  /** Absent when every slot is in use. */
  onNew?: () => void;
  extra?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        <span className="text-xs text-kumo-subtle">{used}</span>
      </div>
      <p className="m-0 mb-1 leading-snug text-kumo-subtle">{description}</p>
      {extra}
      <ul aria-label={`${title} entries`} className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((it) => {
          const current = it.id === selected;
          return (
            <li key={it.id}>
              <button
                type="button"
                aria-pressed={current}
                onClick={() => onSelect(it.id)}
                className={
                  "flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border px-3.5 py-3 text-left " +
                  (current
                    ? "border-accent bg-accent-tint"
                    : "border-kumo-line bg-kumo-base hover:bg-kumo-tint")
                }
              >
                <span className="flex w-full justify-between gap-2">
                  <strong>{it.title}</strong>
                  <span className={"text-xs " + (current ? "text-accent-link" : "text-kumo-subtle")}>
                    {it.meta}
                  </span>
                </span>
                <span className={"text-sm " + (current ? "" : "text-kumo-subtle")}>{it.summary}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-kumo-line hover:bg-kumo-tint"
        >
          <PlusIcon aria-hidden="true" size={16} />
          {newLabel}
        </button>
      )}
    </section>
  );
}

export function DetailCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-5 rounded-xl border border-kumo-line bg-kumo-elevated p-5 md:p-6"
    >
      {children}
    </section>
  );
}

/** Where a keycode sits in the keymap: "Base, row 0 column 3", … */
export function placementsOf(keyboard: Keyboard, code: number): string[] {
  const names = pickerInfoOf(keyboard).layerNames;
  const name = (l: number) => names?.[l]?.trim() || (l === 0 ? "Base" : `layer ${l}`);
  const out: string[] = [];
  const positions = visiblePositions(keyboard);
  for (let l = 0; l < keyboard.layers; l++) {
    for (const p of positions) {
      if (keyboard.getKey(l, p.row, p.col) === code) out.push(`${name(l)}, row ${p.row} column ${p.col}`);
    }
  }
  return out;
}

export function placedText(places: readonly string[]): string {
  if (places.length === 0) return "not placed";
  return `on ${places.length} ${places.length === 1 ? "key" : "keys"}`;
}

/** A key slot: a keycap with what it is for. */
export function SlotButton({
  title,
  hint,
  cap,
  selected,
  empty,
  onClick,
  label,
}: {
  title: string;
  hint: string;
  cap: string;
  selected: boolean;
  empty: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={
        "flex cursor-pointer items-center gap-3.5 rounded-xl p-3.5 text-left " +
        (selected
          ? "border-2 border-accent bg-accent-tint"
          : empty
            ? "border border-dashed border-kumo-line"
            : "border border-kumo-line bg-kumo-base hover:bg-kumo-tint")
      }
    >
      <span
        aria-hidden="true"
        className={
          "grid size-14 shrink-0 place-items-center rounded-lg p-1 text-center text-[13px] leading-tight whitespace-pre-line " +
          (selected
            ? "border border-accent bg-accent-tint"
            : empty
              ? "border border-dashed border-kumo-line text-kumo-subtle"
              : "border border-kumo-line bg-kumo-tint")
        }
      >
        {empty ? "+" : cap}
      </span>
      <span className="flex flex-col gap-0.5">
        <strong>{title}</strong>
        <span className={"text-xs " + (selected ? "text-accent-link" : "text-kumo-subtle")}>{hint}</span>
      </span>
    </button>
  );
}
