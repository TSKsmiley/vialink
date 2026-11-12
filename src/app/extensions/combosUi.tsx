// SPDX-License-Identifier: GPL-2.0-or-later
// Combos editor tab, following vial-gui's editor/combos.py: every combo has
// four trigger keys ("Key 1".."Key 4") and an output key, edited with the
// keycode picker. Deviation: vial-gui shows one tab per combo; this panel
// shows one row per combo so all of them are visible at once.

import { useState } from "react";
import { combosExtension, describeCombo } from "../../core/extensions/combos.ts";
import { COMBO_INPUTS } from "../../core/protocol/combos.ts";
import { KeycodePicker } from "../components/KeycodePicker.tsx";
import { errorMessage, useKeyboardVersion, pickerInfoOf } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./combos.css";

interface Slot {
  combo: number;
  /** 0-3: trigger keys, 4: output. */
  slot: number;
}

const slotName = (slot: number) => (slot < COMBO_INPUTS ? `key ${slot + 1}` : "output");

export function CombosPanel({ keyboard, onError }: PanelProps) {
  useKeyboardVersion(keyboard);
  const combos = keyboard.extension(combosExtension);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  if (!combos) return null;

  const table = keyboard.keycodes;
  const current = selected ? combos.get(selected.combo)[selected.slot] : null;

  const write = async (combo: number, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      onError(`Combo ${combo + 1}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  /** As in the keymap editor: a basic keycode picked for a masked key (e.g. LSFT(kc)) fills its inner key. */
  const pick = (code: number) => {
    if (!selected || busy) return;
    const value =
      current !== null && table.isMasked(current) && table.isBasic(code) ? (current & 0xff00) | code : code;
    const keepSelection = current !== null && table.isMasked(value) && !table.isMasked(current);
    const target = selected;
    void write(target.combo, async () => {
      await combos.setKey(target.combo, target.slot, value);
      if (keepSelection) return;
      // Move on to the next slot of the same combo, as the keymap editor moves to the next key.
      // Only if the user has not picked another slot while the write was in flight.
      const next = target.slot < COMBO_INPUTS ? { combo: target.combo, slot: target.slot + 1 } : null;
      setSelected((cur) => (cur && cur.combo === target.combo && cur.slot === target.slot ? next : cur));
    });
  };

  return (
    <section className="combos" aria-label="Combos">
      <p className="hint">
        Hold the trigger keys together to send the output key. {combos.count} combo
        {combos.count === 1 ? "" : "s"} available; trigger keys after the first empty slot (KC_NO) are
        ignored.
      </p>
      <ol className="combo-list">
        {combos.entries.map((entry, idx) => {
          const label = `Combo ${idx + 1}`;
          const empty = entry.every((code) => code === 0);
          return (
            <li key={idx} className="combo-row" aria-label={label}>
              <span className="combo-index">{idx + 1}</span>
              <div className="combo-keys" role="group" aria-label={`${label} keys`}>
                {entry.map((code, slot) => {
                  const isSelected = selected?.combo === idx && selected.slot === slot;
                  const cap = table.label(code);
                  return (
                    <span key={slot} className={slot === COMBO_INPUTS ? "combo-slot output" : "combo-slot"}>
                      {slot === COMBO_INPUTS && (
                        <span className="combo-arrow" aria-hidden="true">
                          →
                        </span>
                      )}
                      <button
                        type="button"
                        className={isSelected ? "combo-key active" : "combo-key"}
                        aria-pressed={isSelected}
                        aria-label={`${label} ${slotName(slot)}: ${table.serialize(code)}`}
                        title={cap.tooltip ?? table.serialize(code)}
                        onClick={() => setSelected(isSelected ? null : { combo: idx, slot })}
                      >
                        <span className="combo-key-text">{cap.text === "" ? " " : cap.text}</span>
                        {cap.inner && <span className="combo-key-inner">{cap.inner}</span>}
                      </button>
                    </span>
                  );
                })}
              </div>
              <span className="combo-summary">{empty ? "unused" : describeCombo(table, entry)}</span>
              <button
                type="button"
                className="combo-clear"
                aria-label={`Clear ${label.toLowerCase()}`}
                disabled={busy || empty}
                onClick={() => {
                  if (selected?.combo === idx) setSelected(null);
                  void write(idx, () => combos.set(idx, [0, 0, 0, 0, 0]));
                }}
              >
                Clear
              </button>
            </li>
          );
        })}
      </ol>
      {selected && (
        <p className="hint" aria-live="polite">
          Editing combo {selected.combo + 1}, {slotName(selected.slot)}.
        </p>
      )}
      <KeycodePicker
        info={pickerInfoOf(keyboard)}
        table={table}
        disabled={selected === null || busy}
        current={current}
        onPick={pick}
      />
    </section>
  );
}

export const combosUi: AppExtension = {
  id: combosExtension.id,
  panels: [{ id: "combos", title: "Combos", Component: CombosPanel }],
};
