// SPDX-License-Identifier: GPL-2.0-or-later
// Alt repeat key editor tab, after vial-gui src/main/python/editor/alt_repeat_key.py
// (AltRepeatKey, AltRepeatKeyEntryUI, ModsUI, OptionsUI): one numbered tab per
// entry with Enable, Last key, Alt key, Allowed mods and Options; every change
// is written straight to the board (write-through), as vial-gui's on_change does.
//
// Deviation: vial-gui's key widgets open a keycode picker in a popup; here the
// selected key slot is filled from the regular keycode picker under the form.

import { useState } from "react";
import { altRepeatKeyExtension } from "../../core/extensions/alt-repeat-key.ts";
import {
  AREP_ENABLED,
  AREP_OPTION_BIDIRECTIONAL,
  AREP_OPTION_DEFAULT_TO_THIS_ALT_KEY,
  AREP_OPTION_IGNORE_MOD_HANDEDNESS,
  type AltRepeatKeyEntry,
} from "../../core/protocol/alt-repeat-key.ts";
import { KeycodePicker } from "../components/KeycodePicker.tsx";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./alt-repeat-key.css";

/** ModsUI checkbox order: bit n of allowed_mods. Shown left mods on the first row, right on the second. */
const MODS = ["LCtrl", "LShift", "LAlt", "LGui", "RCtrl", "RShift", "RAlt", "RGui"];

/** OptionsUI checkboxes. */
const OPTIONS: [number, string][] = [
  [AREP_OPTION_DEFAULT_TO_THIS_ALT_KEY, "Default to this alt key"],
  [AREP_OPTION_BIDIRECTIONAL, "Bidirectional"],
  [AREP_OPTION_IGNORE_MOD_HANDEDNESS, "Ignore mod handedness"],
];

type Slot = "keycode" | "altKeycode";

function AltRepeatKeyPanel({ keyboard, onError }: PanelProps) {
  useKeyboardVersion(keyboard);
  const state = keyboard.extension(altRepeatKeyExtension);
  const [index, setIndex] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const idx = Math.min(index, state.count - 1);
  const entry = state.get(idx);
  const table = keyboard.keycodes;
  const n = idx + 1;

  const write = async (next: AltRepeatKeyEntry) => {
    setBusy(true);
    try {
      await state.set(idx, next);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (field: "options" | "allowedMods", bit: number, on: boolean) =>
    void write({ ...entry, [field]: on ? entry[field] | bit : entry[field] & ~bit });

  const current = slot ? entry[slot] : null;
  const pick = (code: number) => {
    if (!slot || busy) return;
    // As in the keymap editor: a basic keycode picked for a masked key fills its inner key.
    const value =
      current !== null && table.isMasked(current) && table.isBasic(code) ? (current & 0xff00) | code : code;
    if (!table.isMasked(value) || (current !== null && table.isMasked(current))) setSlot(null);
    void write({ ...entry, [slot]: value });
  };

  const keyButton = (which: Slot, title: string) => {
    const code = entry[which];
    const label = table.label(code);
    const text = label.inner !== null ? `${label.text} (${label.inner})` : label.text;
    return (
      <button
        type="button"
        className={`arep-key${slot === which ? " selected" : ""}`}
        aria-label={`${title} for alt repeat key ${n}: ${table.serialize(code)}`}
        aria-pressed={slot === which}
        title={label.tooltip ?? table.serialize(code)}
        disabled={busy}
        onClick={() => setSlot(slot === which ? null : which)}
      >
        {text.replace(/\n/g, " ") || " "}
      </button>
    );
  };

  return (
    <div className="arep">
      <div className="tabs arep-tabs" role="tablist" aria-label="Alt repeat key entries">
        {state.entries.map((e, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === idx}
            className={`${i === idx ? "active" : ""}${e.options & AREP_ENABLED ? " arep-on" : ""}`}
            onClick={() => {
              setIndex(i);
              setSlot(null);
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className="arep-entry" role="tabpanel" aria-label={`Alt repeat key ${n}`}>
        <label className="arep-label" htmlFor="arep-enable">
          Enable
        </label>
        <div>
          <input
            id="arep-enable"
            type="checkbox"
            checked={(entry.options & AREP_ENABLED) !== 0}
            disabled={busy}
            onChange={(e) => toggle("options", AREP_ENABLED, e.target.checked)}
          />
        </div>

        <span className="arep-label">Last key</span>
        <div>{keyButton("keycode", "Last key")}</div>

        <span className="arep-label">Alt key</span>
        <div>{keyButton("altKeycode", "Alt key")}</div>

        <span className="arep-label" id="arep-mods-label">
          Allowed mods
        </span>
        <div className="arep-mods" role="group" aria-labelledby="arep-mods-label">
          {MODS.map((name, bit) => (
            <label key={name} style={{ gridRow: bit < 4 ? 1 : 2, gridColumn: (bit % 4) + 1 }}>
              <input
                type="checkbox"
                checked={(entry.allowedMods & (1 << bit)) !== 0}
                disabled={busy}
                onChange={(e) => toggle("allowedMods", 1 << bit, e.target.checked)}
              />
              {name}
            </label>
          ))}
        </div>

        <span className="arep-label" id="arep-options-label">
          Options
        </span>
        <div className="arep-options" role="group" aria-labelledby="arep-options-label">
          {OPTIONS.map(([bit, name]) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={(entry.options & bit) !== 0}
                disabled={busy}
                onChange={(e) => toggle("options", bit, e.target.checked)}
              />
              {name}
            </label>
          ))}
        </div>
      </div>

      {slot === null && <p className="hint">Select Last key or Alt key, then pick a keycode below.</p>}
      <KeycodePicker table={table} disabled={slot === null || busy} current={current} onPick={pick} />
    </div>
  );
}

export const altRepeatKeyUi: AppExtension = {
  id: altRepeatKeyExtension.id,
  panels: [{ id: "alt-repeat-key", title: "Alt Repeat Key", Component: AltRepeatKeyPanel }],
};
