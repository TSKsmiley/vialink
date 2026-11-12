// SPDX-License-Identifier: GPL-2.0-or-later
// The Tap Dance tab of the keycode picker. vial-gui shows TD(0) ... TD(n) as a
// flat grid; here the tap dances that are set up are listed with what they do,
// and the unused ones are behind "New tap dance" (the first free slot) and a
// dropdown. The keycodes are the same TD(n) values.

import type { Keycode } from "../../core/keycodes/table.ts";

const TD_RE = /^TD\((\d+)\)$/;

interface Props {
  /** The "tapdance" group's keycodes. */
  keycodes: readonly Keycode[];
  /** Per tap dance: a summary, or null when it is not set up. */
  summaries: readonly (string | null)[];
  disabled: boolean;
  current: number | null;
  onPick: (code: number) => void;
}

export function TapDancePicker({ keycodes, summaries, disabled, current, onPick }: Props) {
  const entries = keycodes.flatMap((kc) => {
    const m = TD_RE.exec(kc.qmk_id);
    return m ? [{ index: Number(m[1]), kc, summary: summaries[Number(m[1])] ?? null }] : [];
  });
  const used = entries.filter((e) => e.summary !== null || e.kc.value === current);
  const free = entries.filter((e) => !used.includes(e));

  return (
    <div className="td-picker">
      {used.length === 0 ? (
        <p className="hint">No tap dances are set up yet. Create one in the Tap Dance tab of the editor.</p>
      ) : (
        <ul className="td-list">
          {used.map(({ index, kc, summary }) => {
            const isCurrent = kc.value === current;
            return (
              <li key={index}>
                <button
                  type="button"
                  className={`td-option${isCurrent ? " current" : ""}`}
                  disabled={disabled}
                  aria-pressed={isCurrent}
                  title={kc.qmk_id}
                  onClick={() => onPick(kc.value)}
                >
                  <span className="td-name">TD {index}</span>
                  <span className="td-summary">{summary ?? "Not set up yet"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {free.length > 0 && (
        <div className="td-free">
          <button
            type="button"
            disabled={disabled}
            title={`${free[0].kc.qmk_id}: set it up in the Tap Dance tab`}
            onClick={() => onPick(free[0].kc.value)}
          >
            New tap dance (TD {free[0].index})
          </button>
          {free.length > 1 && (
            <select
              aria-label="Unused tap dance"
              disabled={disabled}
              value=""
              onChange={(e) => {
                const entry = free.find((f) => String(f.index) === e.target.value);
                if (entry) onPick(entry.kc.value);
              }}
            >
              <option value="" disabled>
                Other unused…
              </option>
              {free.map(({ index }) => (
                <option key={index} value={index}>
                  TD {index}
                </option>
              ))}
            </select>
          )}
          <span className="hint">Set up what it does in the Tap Dance tab.</span>
        </div>
      )}
    </div>
  );
}
