// SPDX-License-Identifier: GPL-2.0-or-later
// Tap dance editor tab, following vial-gui's editor/tap_dance.py: one entry per
// TD(n) with On tap, On hold, On double tap, On tap + hold and Tapping term
// (ms, 0–10000 as in its QSpinBox).
//
// Deviations: entries are cards on one page instead of numbered tabs; keycodes
// are typed as QMK ids (parsed by keyboard.keycodes.parse) instead of picked
// from the keycode tabs; every change, including the tapping term, is written
// with the card's Save button (vial-gui writes key changes at once and the
// tapping term on Save). Revert resets the card to the board's stored entry.
// A stored tapping term above 10000 is clamped to 10000 when the card loads,
// as QSpinBox.setValue does, and the card shows as modified until it is saved
// (vial-gui marks the tab modified the same way and writes 10000 on Save).

import { useId, useState } from "react";
import { TapDance, tapDanceExtension } from "../../core/extensions/tap-dance.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import {
  TAP_DANCE_KEY_FIELDS,
  type TapDanceEntry,
  type TapDanceKeyField,
} from "../../core/protocol/tap-dance.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./tap-dance.css";

const FIELD_LABELS: Record<TapDanceKeyField, string> = {
  onTap: "On tap",
  onHold: "On hold",
  onDoubleTap: "On double tap",
  onTapHold: "On tap + hold",
};

/** vial-gui's QSpinBox range for the tapping term. */
const TAPPING_TERM_MAX = 10000;

interface Draft {
  keys: Record<TapDanceKeyField, string>;
  term: string;
}

function toDraft(keyboard: Keyboard, entry: Readonly<TapDanceEntry>): Draft {
  const keys = {} as Record<TapDanceKeyField, string>;
  for (const f of TAP_DANCE_KEY_FIELDS) keys[f] = keyboard.keycodes.serialize(entry[f]);
  // QSpinBox.setValue clamps to its range (0..10000).
  return { keys, term: String(Math.min(entry.tappingTerm, TAPPING_TERM_MAX)) };
}

/** Parses a draft; returns the entry or a message per invalid field. */
function parseDraft(
  keyboard: Keyboard,
  draft: Draft,
): { entry: TapDanceEntry | null; errors: Partial<Record<TapDanceKeyField | "term", string>> } {
  const errors: Partial<Record<TapDanceKeyField | "term", string>> = {};
  const entry = { tappingTerm: 0 } as TapDanceEntry;
  for (const f of TAP_DANCE_KEY_FIELDS) {
    const text = draft.keys[f].trim();
    try {
      entry[f] = keyboard.keycodes.parse(text === "" ? "KC_NO" : text);
    } catch (err) {
      errors[f] = errorMessage(err);
    }
  }
  const term = draft.term.trim();
  if (!/^\d+$/.test(term) || Number(term) > TAPPING_TERM_MAX) {
    errors.term = `Enter a whole number from 0 to ${TAPPING_TERM_MAX}.`;
  } else {
    entry.tappingTerm = Number(term);
  }
  return { entry: Object.keys(errors).length ? null : entry, errors };
}

interface CardProps {
  keyboard: Keyboard;
  state: TapDance;
  idx: number;
  onError: (message: string) => void;
}

function TapDanceCard({ keyboard, state, idx, onError }: CardProps) {
  const stored = state.get(idx);
  const [draft, setDraft] = useState<Draft>(() => toDraft(keyboard, stored));
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const { entry, errors } = parseDraft(keyboard, draft);
  const original = toDraft(keyboard, stored);
  // Compare with the stored term, not the clamped one, so a clamped term counts as a change.
  const edited =
    draft.term !== String(stored.tappingTerm) ||
    TAP_DANCE_KEY_FIELDS.some((f) => draft.keys[f] !== original.keys[f]);
  const idBase = `${useId()}-td${idx}`;
  const headingId = `${idBase}-title`;

  const save = async () => {
    setShowErrors(true);
    if (!entry) return;
    setBusy(true);
    try {
      // Write-through: TapDance.set sends nothing when the entry is unchanged.
      await state.set(idx, entry);
      setDraft(toDraft(keyboard, state.get(idx)));
      setShowErrors(false);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: TapDanceKeyField | "term") =>
    showErrors && errors[field] ? (
      <span className="error" role="alert" id={`${idBase}-${field}-error`}>
        {errors[field]}
      </span>
    ) : null;

  return (
    <form
      className="tap-dance-card"
      noValidate
      aria-labelledby={headingId}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 id={headingId}>
        TD({idx}){edited ? <span className="tap-dance-modified"> (modified)</span> : null}
      </h3>
      {TAP_DANCE_KEY_FIELDS.map((f) => (
        <div key={f} className="tap-dance-field">
          <label htmlFor={`${idBase}-${f}`}>{FIELD_LABELS[f]}</label>
          <input
            id={`${idBase}-${f}`}
            value={draft.keys[f]}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={showErrors && errors[f] ? true : undefined}
            aria-describedby={showErrors && errors[f] ? `${idBase}-${f}-error` : undefined}
            onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, [f]: e.target.value } })}
          />
          {fieldError(f)}
        </div>
      ))}
      <div className="tap-dance-field">
        <label htmlFor={`${idBase}-term`}>Tapping term (ms)</label>
        <input
          id={`${idBase}-term`}
          type="number"
          min={0}
          max={TAPPING_TERM_MAX}
          step={1}
          value={draft.term}
          disabled={busy}
          aria-invalid={showErrors && errors.term ? true : undefined}
          aria-describedby={showErrors && errors.term ? `${idBase}-term-error` : undefined}
          onChange={(e) => setDraft({ ...draft, term: e.target.value })}
        />
        {fieldError("term")}
      </div>
      <div className="tap-dance-actions">
        <button type="submit" className="primary" disabled={busy || !edited}>
          Save TD({idx})
        </button>
        <button
          type="button"
          disabled={busy || !edited}
          onClick={() => {
            setDraft(original);
            setShowErrors(false);
          }}
        >
          Revert TD({idx})
        </button>
      </div>
      <p className="hint">
        Use <code>TD({idx})</code> to set up this action in the keymap.
      </p>
    </form>
  );
}

export function TapDancePanel({ keyboard, onError }: PanelProps) {
  useKeyboardVersion(keyboard);
  const state = keyboard.extension(tapDanceExtension);
  if (!state) return null;

  return (
    <section className="tap-dance" aria-label="Tap dance">
      <h2>Tap dance</h2>
      <p className="hint">
        Type QMK keycodes such as <code>KC_A</code>, <code>LCTL(KC_C)</code> or <code>MO(1)</code>; leave a
        field empty for <code>KC_NO</code>.
      </p>
      <div className="tap-dance-list">
        {state.entries.map((entry, idx) => (
          // Remount when the stored entry changes (e.g. after a .vil restore) so the draft follows it.
          <TapDanceCard
            key={`${idx}:${Object.values(entry).join(",")}`}
            keyboard={keyboard}
            state={state}
            idx={idx}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

export const tapDanceUi: AppExtension = {
  id: tapDanceExtension.id,
  panels: [
    {
      id: "tap-dance",
      title: "Tap dance",
      Component: TapDancePanel,
      count: (kb) =>
        kb.extension(tapDanceExtension)?.entries.filter((e) => TAP_DANCE_KEY_FIELDS.some((f) => e[f] !== 0))
          .length ?? null,
    },
  ],
};
