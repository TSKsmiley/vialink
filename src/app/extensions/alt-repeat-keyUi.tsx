// SPDX-License-Identifier: GPL-2.0-or-later
// Alt repeat key editor, after vial-gui src/main/python/editor/alt_repeat_key.py
// (AltRepeatKey, AltRepeatKeyEntryUI, ModsUI, OptionsUI): per entry Enable,
// Last key, Alt key, Allowed mods and Options; every change is written straight
// to the board (write-through), as vial-gui's on_change does.
//
// Deviations:
// - the layout of the other feature views (design boards 2-4): the entries in
//   use in a list, one in detail, instead of one numbered tab per entry;
// - the keys are slots chosen by search (as in tap dance), not vial-gui's
//   picker popup; Clear empties both;
// - allowed mods are toggle chips, left hand over right hand.

import { useState } from "react";
import { altRepeatKeyExtension, type AltRepeatKeys } from "../../core/extensions/alt-repeat-key.ts";
import type { DeviceContext } from "../../core/extensions/types.ts";
import type { KeycodeTable } from "../../core/keycodes/table.ts";
import {
  AREP_ENABLED,
  AREP_OPTION_BIDIRECTIONAL,
  AREP_OPTION_DEFAULT_TO_THIS_ALT_KEY,
  AREP_OPTION_IGNORE_MOD_HANDEDNESS,
  type AltRepeatKeyEntry,
} from "../../core/protocol/alt-repeat-key.ts";
import { errorMessage } from "../hooks.ts";
import { KeySearch, keyText } from "../keymap/KeySearch.tsx";
import { Button, Switch } from "../ui/index.ts";
import { DetailCard, EntryList, FeatureLayout, SlotButton } from "./featureLayout.tsx";
import { panel, type AppExtension, type PanelProps } from "./registry.tsx";

/** ModsUI order: bit n of allowed_mods; left-hand mods are bits 0-3, right-hand 4-7. */
const MODS = ["LCtrl", "LShift", "LAlt", "LGui", "RCtrl", "RShift", "RAlt", "RGui"];
const MOD_WORDS = ["Ctrl", "Shift", "Alt", "GUI"];

/** OptionsUI checkboxes. */
const OPTIONS: [number, string][] = [
  [AREP_OPTION_DEFAULT_TO_THIS_ALT_KEY, "Default to this alt key"],
  [AREP_OPTION_BIDIRECTIONAL, "Bidirectional"],
  [AREP_OPTION_IGNORE_MOD_HANDEDNESS, "Ignore mod handedness"],
];

type Slot = "keycode" | "altKeycode";
const SLOTS: Record<Slot, { title: string; hint: string }> = {
  keycode: { title: "Last key", hint: "The key you pressed last" },
  altKeycode: { title: "Alt key", hint: "What Alt Repeat sends after it" },
};

const isSet = (e: Readonly<AltRepeatKeyEntry>) => e.keycode !== 0 || e.altKeycode !== 0;

function summary(table: KeycodeTable, e: Readonly<AltRepeatKeyEntry>): string {
  if (!isSet(e)) return "Not set up";
  return `${e.keycode ? keyText(table, e.keycode) : "nothing"} → ${e.altKeycode ? keyText(table, e.altKeycode) : "nothing"}`;
}

function AltRepeatKeyPanel({ ctx, state }: PanelProps<AltRepeatKeys>) {
  const table = ctx.board.keycodes;
  const used = state.entries.flatMap((e, i) => (isSet(e) ? [i] : []));
  const [selected, setSelected] = useState(used[0] ?? 0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const shown = used.includes(selected) ? used : [...used, selected].sort((a, b) => a - b);
  const free = state.entries.findIndex((e, i) => !isSet(e) && i !== selected);

  return (
    <FeatureLayout
      list={
        <EntryList
          title="Alt repeat key"
          used={`${used.length} of ${state.count} used`}
          description="Pairs for QMK's Alt Repeat Key: after the last key, Alt Repeat sends its partner."
          items={shown.map((i) => ({
            id: i,
            title: `Pair ${i + 1}`,
            meta: (state.get(i).options & AREP_ENABLED) !== 0 ? "on" : "off",
            summary: summary(table, state.get(i)),
          }))}
          selected={selected}
          onSelect={(i) => {
            setSelected(i);
            setSlot(null);
          }}
          newLabel="New pair"
          onNew={
            free === -1
              ? undefined
              : () => {
                  setSelected(free);
                  setSlot("keycode");
                }
          }
        />
      }
      detail={
        <PairDetail key={selected} ctx={ctx} state={state} index={selected} slot={slot} onSlot={setSlot} />
      }
    />
  );
}

function PairDetail({
  ctx,
  state,
  index,
  slot,
  onSlot,
}: {
  ctx: DeviceContext;
  state: AltRepeatKeys;
  index: number;
  slot: Slot | null;
  onSlot: (s: Slot | null) => void;
}) {
  const table = ctx.board.keycodes;
  const entry = state.get(index);
  const n = index + 1;
  const [busy, setBusy] = useState(false);

  const write = async (next: AltRepeatKeyEntry) => {
    setBusy(true);
    try {
      await state.set(index, next);
    } catch (err) {
      ctx.notify.error(`Alt repeat key ${n}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (field: "options" | "allowedMods", bit: number, on: boolean) =>
    void write({ ...entry, [field]: on ? entry[field] | bit : entry[field] & ~bit });

  const title = isSet(entry)
    ? `After ${entry.keycode ? keyText(table, entry.keycode) : "nothing"}, Alt Repeat sends ${entry.altKeycode ? keyText(table, entry.altKeycode) : "nothing"}`
    : `Alt repeat key ${n}`;
  const chip = (on: boolean) =>
    "min-h-9 cursor-pointer rounded-lg border px-3 text-sm disabled:cursor-default disabled:opacity-50 " +
    (on ? "border-accent bg-accent-tint font-semibold" : "border-kumo-line hover:bg-kumo-tint");

  return (
    <DetailCard label={`Alt repeat key ${n}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <div className="flex-1" />
        <Switch
          label="Enabled"
          checked={(entry.options & AREP_ENABLED) !== 0}
          onCheckedChange={(on) => toggle("options", AREP_ENABLED, on)}
        />
        <Button
          variant="secondary-destructive"
          disabled={busy || !isSet(entry)}
          onClick={() => void write({ ...entry, keycode: 0, altKeycode: 0 })}
        >
          Clear
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["keycode", "altKeycode"] as const).map((f) => {
          const code = entry[f];
          return (
            <SlotButton
              key={f}
              title={SLOTS[f].title}
              hint={slot === f ? "Choosing a key below" : code ? SLOTS[f].hint : `${SLOTS[f].hint}: not set`}
              cap={keyText(table, code)}
              selected={slot === f}
              empty={code === 0}
              onClick={() => onSlot(slot === f ? null : f)}
              label={`${SLOTS[f].title} for alt repeat key ${n}: ${table.serialize(code)}`}
            />
          );
        })}
      </div>
      {slot && (
        <KeySearch
          table={table}
          label={`${SLOTS[slot].title}: choose a key`}
          disabled={busy}
          onPick={(code) => {
            void write({ ...entry, [slot]: code });
            onSlot(null);
          }}
        />
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-kumo-line p-0 pt-4">
        <legend className="float-left m-0 w-full text-sm font-semibold">Allowed mods</legend>
        <span className="text-xs text-kumo-subtle">
          Modifiers that may be held with the last key for this pair to apply.
        </span>
        {[0, 4].map((side) => (
          <div key={side} className="flex flex-wrap items-center gap-1.5">
            <span className="w-10 text-xs text-kumo-subtle">{side ? "Right" : "Left"}</span>
            {MOD_WORDS.map((word, i) => {
              const bit = 1 << (side + i);
              const on = (entry.allowedMods & bit) !== 0;
              return (
                <button
                  key={word}
                  type="button"
                  aria-pressed={on}
                  aria-label={MODS[side + i]}
                  disabled={busy}
                  onClick={() => toggle("allowedMods", bit, !on)}
                  className={chip(on)}
                >
                  {word}
                </button>
              );
            })}
          </div>
        ))}
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-kumo-line p-0 pt-4">
        <legend className="float-left m-0 mb-1 w-full text-sm font-semibold">Options</legend>
        {OPTIONS.map(([bit, name]) => (
          <label key={name} className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={(entry.options & bit) !== 0}
              disabled={busy}
              onChange={(e) => toggle("options", bit, e.target.checked)}
            />
            {name}
          </label>
        ))}
      </fieldset>
    </DetailCard>
  );
}

export const altRepeatKeyUi: AppExtension = {
  id: altRepeatKeyExtension.id,
  panels: [
    panel<AltRepeatKeys>({
      id: "alt-repeat-key",
      modern: true,
      title: "Alt repeat key",
      Component: AltRepeatKeyPanel,
      count: (state) => state.entries.filter(isSet).length,
    }),
  ],
};
