// SPDX-License-Identifier: GPL-2.0-or-later
// Key override editor, following vial-gui src/main/python/editor/key_override.py
// (KeyOverrideEntryUI, LayersUI, ModsUI, OptionsUI): every change is written
// straight to the board.
// Deviations:
// - the layout of the other feature views (design boards 2-4): the overrides
//   in use in a list, one in detail, instead of one tab per entry;
// - the trigger and replacement are key slots chosen by search (as in tap
//   dance), not vial-gui's picker popup; a Clear empties both;
// - layers are chips for this keyboard's layers only (named when the board
//   names them); bits for layers it doesn't have are kept as they are;
// - modifiers are toggle chips, left hand over right hand;
// - the labels of options bit 4 (no_reregister_trigger) and bit 5
//   (no_unregister_on_other_key_down) follow QMK's documented meaning;
//   vial-gui shows them swapped.

import { useState } from "react";
import { keyOverridesExtension, type KeyOverrides } from "../../core/extensions/key-overrides.ts";
import type { BoardView, DeviceContext } from "../../core/extensions/types.ts";
import type { KeycodeTable } from "../../core/keycodes/table.ts";
import {
  KO_ENABLED,
  KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP,
  KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN,
  KO_OPTION_ACTIVATION_TRIGGER_DOWN,
  KO_OPTION_NO_REREGISTER_TRIGGER,
  KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN,
  KO_OPTION_ONE_MOD,
  type KeyOverrideEntry,
} from "../../core/protocol/key-overrides.ts";
import { errorMessage } from "../hooks.ts";
import { KeySearch, keyText } from "../keymap/KeySearch.tsx";
import { Button, Switch } from "../ui/index.ts";
import { DetailCard, EntryList, FeatureLayout, SlotButton } from "./featureLayout.tsx";
import type { PanelKit } from "./kit.tsx";
import { panel, type AppExtension, type PanelProps } from "./registry.tsx";

type KeyField = "trigger" | "replacement";
type ModField = "triggerMods" | "negativeModMask" | "suppressedMods";

/** ModsUI order: bit n = mods[n]; left-hand mods are bits 0-3, right-hand 4-7. */
const MODS = ["LCtrl", "LShift", "LAlt", "LGui", "RCtrl", "RShift", "RAlt", "RGui"];
const MOD_WORDS = ["Ctrl", "Shift", "Alt", "GUI"];
const ALL_LAYERS = 0xffff;

const OPTIONS: [bit: number, label: string][] = [
  [KO_OPTION_ACTIVATION_TRIGGER_DOWN, "Activate when the trigger key is pressed down"],
  [KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN, "Activate when a necessary modifier is pressed down"],
  [KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP, "Activate when a negative modifier is released"],
  [KO_OPTION_ONE_MOD, "Activate on one modifier"],
  [KO_OPTION_NO_REREGISTER_TRIGGER, "Don't register the trigger key again after the override is deactivated"],
  [KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN, "Don't deactivate when another key is pressed down"],
];

const SLOTS: Record<KeyField, { title: string; hint: string }> = {
  trigger: { title: "Trigger", hint: "The key you press" },
  replacement: { title: "Replacement", hint: "What it sends instead" },
};

const MOD_GROUPS: { field: ModField; title: string; hint: string }[] = [
  { field: "triggerMods", title: "Trigger mods", hint: "Held with the trigger key to activate it." },
  { field: "negativeModMask", title: "Negative mods", hint: "Holding any of these keeps it off." },
  { field: "suppressedMods", title: "Suppressed mods", hint: "Released while the replacement is sent." },
];

const isSet = (e: Readonly<KeyOverrideEntry>) => e.trigger !== 0 || e.replacement !== 0;

/** "Shift + Bksp", from the trigger mods and key. */
function chord(table: KeycodeTable, mods: number, code: number): string {
  const names = MODS.flatMap((_, bit) =>
    mods & (1 << bit) ? [(bit >= 4 ? "Right " : "") + MOD_WORDS[bit % 4]] : [],
  );
  return [...names, keyText(table, code)].join(" + ");
}

function summary(table: KeycodeTable, e: Readonly<KeyOverrideEntry>): string {
  if (!isSet(e)) return "Not set up";
  const from = e.trigger ? chord(table, e.triggerMods, e.trigger) : "nothing";
  return `${from} → ${e.replacement ? keyText(table, e.replacement) : "nothing"}`;
}

function KeyOverridesPanel({ ctx, state: ko, ui }: PanelProps<KeyOverrides>) {
  const table = ctx.board.keycodes;
  const used = ko.entries.flatMap((e, i) => (isSet(e) ? [i] : []));
  const [selected, setSelected] = useState(used[0] ?? 0);
  const [slot, setSlot] = useState<KeyField | null>(null);
  const shown = used.includes(selected) ? used : [...used, selected].sort((a, b) => a - b);
  const free = ko.entries.findIndex((e, i) => !isSet(e) && i !== selected);

  return (
    <FeatureLayout
      list={
        <EntryList
          title="Key overrides"
          used={`${used.length} of ${ko.count} used`}
          description="Send another key while modifiers are held: Shift + Backspace sends Delete, for example."
          items={shown.map((i) => ({
            id: i,
            title: `Override ${i + 1}`,
            meta: (ko.get(i).options & KO_ENABLED) !== 0 ? "on" : "off",
            summary: summary(table, ko.get(i)),
          }))}
          selected={selected}
          onSelect={(i) => {
            setSelected(i);
            setSlot(null);
          }}
          newLabel="New key override"
          onNew={
            free === -1
              ? undefined
              : () => {
                  setSelected(free);
                  setSlot("trigger");
                }
          }
        />
      }
      detail={
        <OverrideDetail
          key={selected}
          ctx={ctx}
          ui={ui}
          ko={ko}
          index={selected}
          slot={slot}
          onSlot={setSlot}
        />
      }
    />
  );
}

function OverrideDetail({
  ctx,
  ui,
  ko,
  index,
  slot,
  onSlot,
}: {
  ctx: DeviceContext;
  ui: PanelKit;
  ko: KeyOverrides;
  index: number;
  slot: KeyField | null;
  onSlot: (s: KeyField | null) => void;
}) {
  const board: BoardView = ctx.board;
  const table = board.keycodes;
  const entry = ko.get(index);
  const n = index + 1;
  const enabled = (entry.options & KO_ENABLED) !== 0;
  const names = ui.pickerInfo().layerNames;
  const layerName = (l: number) => names?.[l]?.trim() || (l === 0 ? "Base" : `Layer ${l}`);
  const [busy, setBusy] = useState(false);

  const write = async (
    patch: Partial<KeyOverrideEntry> | ((e: KeyOverrideEntry) => Partial<KeyOverrideEntry>),
  ) => {
    setBusy(true);
    try {
      await ko.update(index, patch);
    } catch (err) {
      ctx.notify.error(`Key override ${n}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };
  const setBit = (field: ModField | "layers" | "options", bit: number, on: boolean) =>
    void write((e) => ({ [field]: on ? e[field] | bit : e[field] & ~bit }));

  const title = isSet(entry)
    ? `${entry.trigger ? chord(table, entry.triggerMods, entry.trigger) : "Nothing"} sends ${entry.replacement ? keyText(table, entry.replacement) : "nothing"}`
    : `Key override ${n}`;
  const chip = (on: boolean) =>
    "min-h-9 cursor-pointer rounded-lg border px-3 text-sm disabled:cursor-default disabled:opacity-50 " +
    (on ? "border-accent bg-accent-tint font-semibold" : "border-kumo-line hover:bg-kumo-tint");
  const heading = "m-0 text-sm font-semibold";

  return (
    <DetailCard label={`Key override ${n}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <div className="flex-1" />
        <Switch
          label="Enabled"
          checked={enabled}
          onCheckedChange={(on) => setBit("options", KO_ENABLED, on)}
        />
        <Button
          variant="secondary-destructive"
          disabled={busy || !isSet(entry)}
          onClick={() => void write({ trigger: 0, replacement: 0 })}
        >
          Clear
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["trigger", "replacement"] as const).map((f) => {
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
              label={`${SLOTS[f].title} of key override ${n}: ${table.serialize(code)}`}
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
            void write({ [slot]: code });
            onSlot(null);
          }}
        />
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-kumo-line p-0 pt-4">
        <legend className={`${heading} float-left mb-2 w-full`}>Enable on layers</legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: Math.min(board.layers, 16) }, (_, l) => {
            const on = (entry.layers & (1 << l)) !== 0;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                aria-label={`Layer ${l}`}
                disabled={busy}
                onClick={() => setBit("layers", 1 << l, !on)}
                className={chip(on)}
              >
                {layerName(l)}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-kumo-line" aria-hidden="true" />
          <button
            type="button"
            className="cursor-pointer text-sm text-accent-link underline"
            onClick={() => void write({ layers: ALL_LAYERS })}
          >
            All layers
          </button>
          <button
            type="button"
            className="cursor-pointer text-sm text-accent-link underline"
            onClick={() => void write({ layers: 0 })}
          >
            None
          </button>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 border-t border-kumo-line pt-4 lg:grid-cols-3">
        {MOD_GROUPS.map(({ field, title: t, hint }) => (
          <fieldset key={field} className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={`${heading} float-left w-full`}>{t}</legend>
            <span className="text-xs text-kumo-subtle">{hint}</span>
            {[0, 4].map((side) => (
              <div key={side} className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 text-xs text-kumo-subtle">{side ? "Right" : "Left"}</span>
                {MOD_WORDS.map((word, i) => {
                  const bit = 1 << (side + i);
                  const on = (entry[field] & bit) !== 0;
                  return (
                    <button
                      key={word}
                      type="button"
                      aria-pressed={on}
                      aria-label={MODS[side + i]}
                      disabled={busy}
                      onClick={() => setBit(field, bit, !on)}
                      className={chip(on)}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>
            ))}
          </fieldset>
        ))}
      </div>

      <details className="border-t border-kumo-line pt-3">
        <summary className="cursor-pointer text-sm">More options: when it activates and lets go</summary>
        <div className="mt-3 flex flex-col gap-2">
          {OPTIONS.map(([bit, label]) => (
            <label key={bit} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={(entry.options & bit) !== 0}
                onChange={(e) => setBit("options", bit, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
    </DetailCard>
  );
}

export const keyOverridesUi: AppExtension = {
  id: keyOverridesExtension.id,
  panels: [
    panel<KeyOverrides>({
      id: "key-overrides",
      modern: true,
      title: "Key overrides",
      Component: KeyOverridesPanel,
      count: (ko) => ko.entries.filter(isSet).length,
    }),
  ],
};
