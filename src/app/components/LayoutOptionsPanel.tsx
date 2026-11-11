// SPDX-License-Identifier: GPL-2.0-or-later
import { describeLayoutLabel } from "../../core/definition/layoutOptions.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { useKeyboardVersion } from "../hooks.ts";

interface Props {
  keyboard: Keyboard;
  onChange: (choices: number[]) => void;
  busy: boolean;
}

/** Layout options from vial.json; changing one writes it and re-renders the view. */
export function LayoutOptionsPanel({ keyboard, onChange, busy }: Props) {
  useKeyboardVersion(keyboard);
  const labels = keyboard.layoutLabels;
  if (!labels) return null;
  const choices = keyboard.layoutChoices;

  return (
    <section className="layout-options" aria-label="Layout options">
      <h2>Layout options</h2>
      {labels.map((label, i) => {
        const { title, choices: names } = describeLayoutLabel(label);
        const set = (value: number) => onChange(choices.map((c, j) => (j === i ? value : c)));
        if (names === null) {
          return (
            <label key={i} className="option">
              <input
                type="checkbox"
                checked={choices[i] === 1}
                disabled={busy}
                onChange={(e) => set(e.target.checked ? 1 : 0)}
              />
              {title}
            </label>
          );
        }
        return (
          <label key={i} className="option">
            {title}
            <select value={choices[i]} disabled={busy} onChange={(e) => set(Number(e.target.value))}>
              {names.map((name, value) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </section>
  );
}
