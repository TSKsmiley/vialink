// SPDX-License-Identifier: GPL-2.0-or-later
// Key override editor, following vial-gui src/main/python/editor/key_override.py
// (KeyOverrideEntryUI, LayersUI, ModsUI, OptionsUI): every change is written
// straight to the board. Deviations: one card per entry instead of one tab per
// entry, and the labels of options bit 4 (no_reregister_trigger) and bit 5
// (no_unregister_on_other_key_down) follow QMK's documented meaning; vial-gui
// shows them swapped.

import { useState } from "react";
import { keyOverridesExtension, type KeyOverrides } from "../../core/extensions/key-overrides.ts";
import type { Keyboard } from "../../core/keyboard.ts";
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
import { KeycodePicker } from "../components/KeycodePicker.tsx";
import { errorMessage, useKeyboardVersion, pickerInfoOf } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./key-overrides.css";

type KeyField = "trigger" | "replacement";
type MaskField = "layers" | "triggerMods" | "negativeModMask" | "suppressedMods" | "options";

interface Selection {
  index: number;
  field: KeyField;
}

/** ModsUI order: bit n = mods[n]; laid out left mods over right mods. */
const MODS = ["LCtrl", "LShift", "LAlt", "LGui", "RCtrl", "RShift", "RAlt", "RGui"];
const LAYER_BITS = 16;

const OPTIONS: [bit: number, label: string][] = [
  [KO_OPTION_ACTIVATION_TRIGGER_DOWN, "Activate when the trigger key is pressed down"],
  [KO_OPTION_ACTIVATION_REQUIRED_MOD_DOWN, "Activate when a necessary modifier is pressed down"],
  [KO_OPTION_ACTIVATION_NEGATIVE_MOD_UP, "Activate when a negative modifier is released"],
  [KO_OPTION_ONE_MOD, "Activate on one modifier"],
  [KO_OPTION_NO_REREGISTER_TRIGGER, "Don't register the trigger key again after the override is deactivated"],
  [KO_OPTION_NO_UNREGISTER_ON_OTHER_KEY_DOWN, "Don't deactivate when another key is pressed down"],
];

const FIELD_NAMES: Record<KeyField, string> = { trigger: "Trigger", replacement: "Replacement" };

function KeyOverridesPanel({ keyboard, onError }: PanelProps) {
  useKeyboardVersion(keyboard);
  const ko = keyboard.extension(keyOverridesExtension);
  const [selection, setSelection] = useState<Selection | null>(null);
  if (!ko) return null;

  const run = (job: Promise<void>) => {
    job.catch((err: unknown) => onError(errorMessage(err)));
  };

  const current = selection ? ko.get(selection.index)[selection.field] : null;

  /** As the keymap editor: a basic keycode picked for a masked one (e.g. LSFT(kc)) fills its inner key. */
  const pick = (code: number) => {
    if (!selection) return;
    const table = keyboard.keycodes;
    const value =
      current !== null && table.isMasked(current) && table.isBasic(code) ? (current & 0xff00) | code : code;
    const { index, field } = selection;
    run(ko.update(index, { [field]: value }));
  };

  return (
    <div className="key-overrides">
      <p className="hint">
        {ko.count} key override{ko.count === 1 ? "" : "s"}. Changes are written to the keyboard immediately.
      </p>
      <div className="ko-cards">
        {ko.entries.map((entry, index) => (
          <OverrideCard
            key={index}
            keyboard={keyboard}
            ko={ko}
            index={index}
            entry={entry}
            selection={selection}
            onSelect={setSelection}
            run={run}
          />
        ))}
      </div>
      <div className="ko-picker">
        {selection && (
          <p className="hint" aria-live="polite">
            Assigning the {FIELD_NAMES[selection.field].toLowerCase()} of key override {selection.index + 1}.
          </p>
        )}
        <KeycodePicker
          hint="Select a trigger or replacement key above, then pick a keycode."
          info={pickerInfoOf(keyboard)}
          table={keyboard.keycodes}
          disabled={selection === null}
          current={current}
          onPick={pick}
        />
      </div>
    </div>
  );
}

interface CardProps {
  keyboard: Keyboard;
  ko: KeyOverrides;
  index: number;
  entry: Readonly<KeyOverrideEntry>;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  run: (job: Promise<void>) => void;
}

function OverrideCard({ keyboard, ko, index, entry, selection, onSelect, run }: CardProps) {
  const n = index + 1;
  const enabled = (entry.options & KO_ENABLED) !== 0;
  const setBit = (field: MaskField, bit: number, on: boolean) =>
    run(ko.update(index, (e) => ({ [field]: on ? e[field] | bit : e[field] & ~bit })));

  const keyButton = (field: KeyField) => {
    const code = entry[field];
    const label = keyboard.keycodes.label(code);
    const text = label.inner ? `${label.text} ${label.inner}` : label.text;
    const selected = selection?.index === index && selection.field === field;
    return (
      <div className="ko-key-row">
        <span className="ko-row-label">{FIELD_NAMES[field]}</span>
        <button
          type="button"
          className={selected ? "ko-key active" : "ko-key"}
          aria-pressed={selected}
          aria-label={`${FIELD_NAMES[field]} of key override ${n}: ${keyboard.keycodes.serialize(code)}`}
          title={label.tooltip ?? undefined}
          onClick={() => onSelect(selected ? null : { index, field })}
        >
          {text.replace(/\n/g, " ") || " "}
        </button>
      </div>
    );
  };

  const mods = (field: "triggerMods" | "negativeModMask" | "suppressedMods", title: string) => (
    <fieldset className="ko-mods">
      <legend>{title}</legend>
      {MODS.map((name, bit) => (
        <label key={name}>
          <input
            type="checkbox"
            checked={(entry[field] & (1 << bit)) !== 0}
            onChange={(e) => setBit(field, 1 << bit, e.target.checked)}
          />
          {name}
        </label>
      ))}
    </fieldset>
  );

  return (
    <section className={enabled ? "ko-card" : "ko-card disabled"} aria-label={`Key override ${n}`}>
      <header>
        <h3>Key override {n}</h3>
        <label className="ko-enable">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setBit("options", KO_ENABLED, e.target.checked)}
          />
          Enabled
        </label>
      </header>

      {keyButton("trigger")}
      {keyButton("replacement")}

      <fieldset className="ko-layers">
        <legend>Enable on layers</legend>
        <div className="ko-layer-grid">
          {Array.from({ length: LAYER_BITS }, (_, layer) => (
            <label
              key={layer}
              className={layer >= keyboard.layers ? "beyond" : undefined}
              title={layer >= keyboard.layers ? `This keyboard has ${keyboard.layers} layers` : undefined}
            >
              <input
                type="checkbox"
                aria-label={`Layer ${layer}`}
                checked={(entry.layers & (1 << layer)) !== 0}
                onChange={(e) => setBit("layers", 1 << layer, e.target.checked)}
              />
              {layer}
            </label>
          ))}
        </div>
        <div className="ko-layer-actions">
          <button type="button" onClick={() => run(ko.update(index, { layers: 0xffff }))}>
            Enable all
          </button>
          <button type="button" onClick={() => run(ko.update(index, { layers: 0 }))}>
            Disable all
          </button>
        </div>
      </fieldset>

      {mods("triggerMods", "Trigger mods")}
      {mods("negativeModMask", "Negative mods")}
      {mods("suppressedMods", "Suppressed mods")}

      <fieldset className="ko-options">
        <legend>Options</legend>
        {OPTIONS.map(([bit, label]) => (
          <label key={bit}>
            <input
              type="checkbox"
              checked={(entry.options & bit) !== 0}
              onChange={(e) => setBit("options", bit, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

export const keyOverridesUi: AppExtension = {
  id: keyOverridesExtension.id,
  panels: [{ id: "key-overrides", title: "Key overrides", Component: KeyOverridesPanel }],
};
