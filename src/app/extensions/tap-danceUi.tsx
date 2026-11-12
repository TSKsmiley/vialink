// SPDX-License-Identifier: GPL-2.0-or-later
// Tap dance view (design board 2), following vial-gui's editor/tap_dance.py:
// each TD(n) has On tap, On hold, On double tap, On tap + hold and a tapping
// term (ms, 0–10000 as in its QSpinBox).
//
// Deviations from vial-gui:
// - A list of the tap dances that are set up, with what they do, and one in
//   detail; "New tap dance" opens the first unused one (vial-gui: a tab per TD).
// - Each action is a slot: click it, then find a key by name, shortcut or
//   keycode expression. Every change is written at once and is one undo step
//   (vial-gui writes keys at once and the tapping term on Save).
// - A stored tapping term above 10000 shows as 10000, as QSpinBox.setValue
//   clamps it; it is written only when the term is changed.

import { useId, useState } from "react";
import { tapDanceExtension, type TapDance } from "../../core/extensions/tap-dance.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import {
  TAP_DANCE_KEY_FIELDS,
  type TapDanceEntry,
  type TapDanceKeyField,
} from "../../core/protocol/tap-dance.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KeySearch, keyText } from "../keymap/KeySearch.tsx";
import { Button } from "../ui/index.ts";
import {
  DetailCard,
  EntryList,
  FeatureLayout,
  SlotButton,
  placedText,
  placementsOf,
} from "./featureLayout.tsx";
import type { AppExtension, PanelProps } from "./registry.tsx";

const SLOTS: Record<TapDanceKeyField, { title: string; hint: string }> = {
  onTap: { title: "Tap", hint: "A quick press" },
  onHold: { title: "Hold", hint: "Press and hold" },
  onDoubleTap: { title: "Double tap", hint: "Two quick presses" },
  onTapHold: { title: "Tap, then hold", hint: "Press, release, press and hold" },
};

/** vial-gui's QSpinBox range for the tapping term. */
const TAPPING_TERM_MAX = 10000;

const isSet = (e: Readonly<TapDanceEntry>) => TAP_DANCE_KEY_FIELDS.some((f) => e[f] !== 0);

/** "Tap Esc · Hold Caps Lock". */
export function tapDanceSummary(keyboard: Keyboard, e: Readonly<TapDanceEntry>): string {
  const parts = TAP_DANCE_KEY_FIELDS.filter((f) => e[f] !== 0).map(
    (f) => `${SLOTS[f].title} ${keyText(keyboard.keycodes, e[f])}`,
  );
  return parts.length ? parts.join(" · ") : "Not set up";
}

export function TapDancePanel({ keyboard, onError }: PanelProps) {
  useKeyboardVersion(keyboard);
  const state = keyboard.extension(tapDanceExtension);
  const used = state ? state.entries.flatMap((e, i) => (isSet(e) ? [i] : [])) : [];
  const [selected, setSelected] = useState<number>(used[0] ?? 0);
  const [slot, setSlot] = useState<TapDanceKeyField | null>(null);
  if (!state) return null;

  const shown = used.includes(selected) ? used : [...used, selected].sort((a, b) => a - b);
  const free = state.entries.findIndex((e, i) => !isSet(e) && i !== selected);
  const tdCode = (i: number) => keyboard.keycodes.parse(`TD(${i})`);

  return (
    <FeatureLayout
      list={
        <EntryList
          title="Tap dance"
          used={`${used.length} of ${state.count} used`}
          description="One key, up to four actions: tap, hold, double tap, or tap then hold."
          items={shown.map((i) => ({
            id: i,
            title: `TD ${i}`,
            meta: placedText(placementsOf(keyboard, tdCode(i))),
            summary: tapDanceSummary(keyboard, state.get(i)),
          }))}
          selected={selected}
          onSelect={(i) => {
            setSelected(i);
            setSlot(null);
          }}
          newLabel="New tap dance"
          onNew={
            free === -1
              ? undefined
              : () => {
                  setSelected(free);
                  setSlot("onTap");
                }
          }
        />
      }
      detail={
        <TapDanceDetail
          key={selected}
          keyboard={keyboard}
          state={state}
          idx={selected}
          slot={slot}
          onSlot={setSlot}
          onError={onError}
        />
      }
    />
  );
}

function TapDanceDetail({
  keyboard,
  state,
  idx,
  slot,
  onSlot,
  onError,
}: {
  keyboard: Keyboard;
  state: TapDance;
  idx: number;
  slot: TapDanceKeyField | null;
  onSlot: (s: TapDanceKeyField | null) => void;
  onError: (m: string) => void;
}) {
  const id = useId();
  const entry = state.get(idx);
  const table = keyboard.keycodes;
  const places = placementsOf(keyboard, table.parse(`TD(${idx})`));
  const shownTerm = String(Math.min(entry.tappingTerm, TAPPING_TERM_MAX));
  const [term, setTerm] = useState(shownTerm);
  const [termError, setTermError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const write = async (next: TapDanceEntry) => {
    setBusy(true);
    try {
      await state.set(idx, next);
    } catch (err) {
      onError(`TD ${idx}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const commitTerm = (text = term) => {
    const t = text.trim();
    if (!/^\d+$/.test(t) || Number(t) > TAPPING_TERM_MAX) {
      setTermError(`Enter a whole number from 0 to ${TAPPING_TERM_MAX}.`);
      return;
    }
    setTermError(null);
    if (t !== shownTerm) void write({ ...entry, tappingTerm: Number(t) });
  };

  return (
    <DetailCard label={`TD ${idx}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-lg font-semibold">TD {idx}</h2>
        <span className="text-sm text-kumo-subtle">
          {places.length
            ? `Placed on ${places.join("; ")}`
            : "Not on any key yet: use the Tap dance tab of the key inspector"}
        </span>
        <div className="flex-1" />
        <Button
          variant="secondary-destructive"
          disabled={busy || !isSet(entry)}
          onClick={() =>
            void write({ onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: entry.tappingTerm })
          }
        >
          Clear
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TAP_DANCE_KEY_FIELDS.map((f) => (
          <SlotButton
            key={f}
            title={SLOTS[f].title}
            hint={
              slot === f ? "Choosing a key below" : entry[f] ? SLOTS[f].hint : `${SLOTS[f].hint}: not set`
            }
            cap={keyText(table, entry[f])}
            selected={slot === f}
            empty={entry[f] === 0}
            label={`${SLOTS[f].title}: ${entry[f] ? table.serialize(entry[f]) : "not set"}`}
            onClick={() => onSlot(slot === f ? null : f)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${id}-term`} className="font-semibold">
            Tapping term
          </label>
          <span className="inline-flex items-center gap-1.5">
            <input
              id={`${id}-term`}
              type="number"
              min={0}
              max={TAPPING_TERM_MAX}
              value={term}
              disabled={busy}
              aria-invalid={termError ? true : undefined}
              onChange={(e) => setTerm(e.target.value)}
              onBlur={() => commitTerm()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTerm();
              }}
              className="w-24 rounded-md border border-kumo-line bg-kumo-control px-2 py-1 text-right font-mono"
            />
            <span className="text-sm text-kumo-subtle">ms</span>
          </span>
        </div>
        <input
          type="range"
          aria-label="Tapping term slider"
          min={50}
          max={1000}
          step={10}
          value={Math.min(Math.max(Number(term) || 0, 50), 1000)}
          disabled={busy}
          onChange={(e) => setTerm(e.target.value)}
          onPointerUp={(e) => commitTerm((e.target as HTMLInputElement).value)}
          onKeyUp={(e) => commitTerm((e.target as HTMLInputElement).value)}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-xs text-kumo-subtle">
          <span>Faster: taps register sooner</span>
          <span>Slower: easier to double tap</span>
        </div>
        {termError && (
          <span role="alert" className="text-sm text-kumo-danger">
            {termError}
          </span>
        )}
      </div>

      {slot && (
        <div className="flex flex-col gap-2 border-t border-kumo-line pt-4">
          <KeySearch
            table={table}
            label={`${SLOTS[slot].title}: choose a key`}
            disabled={busy}
            onPick={(code) => {
              void write({ ...entry, [slot]: code });
              onSlot(null);
            }}
          />
          {entry[slot] !== 0 && (
            <button
              type="button"
              className="self-start text-sm text-accent-link underline"
              onClick={() => {
                void write({ ...entry, [slot]: 0 });
                onSlot(null);
              }}
            >
              Clear {SLOTS[slot].title.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </DetailCard>
  );
}

export const tapDanceUi: AppExtension = {
  id: tapDanceExtension.id,
  panels: [
    {
      id: "tap-dance",
      modern: true,
      title: "Tap dance",
      Component: TapDancePanel,
      count: (kb) => kb.extension(tapDanceExtension)?.entries.filter(isSet).length ?? null,
    },
  ],
};
