// SPDX-License-Identifier: GPL-2.0-or-later
// Macro editor panel, following vial-gui's editor/macro_recorder.py
// (MacroRecorder: one tab per macro, "M3*" for unsaved changes, "Memory used by
// macros: x/y" in red and Save disabled when over, Save/Revert),
// macro/macro_tab.py (Add action, Tap Enter, move up/down, remove),
// macro/macro_line.py (types Text/Down/Up/Tap, plus "Delay (ms)" from Vial
// protocol 2) and macro/macro_action_ui.py (delay 0..64000 ms; "+" appends
// KC_TRNS; keycodes limited to basic ones below Vial protocol 5, as
// keycode_filter_masked does).
//
// Deviations: keycodes are typed as QMK ids (validated with
// keyboard.keycodes.parse) instead of picked from the keycode tray; there is no
// keystroke recorder (a web page cannot capture system-wide keystrokes) and no
// JSON text editor. Save also needs every keycode and delay to be valid, and
// text to be printable ASCII: vial-gui writes text as UTF-8 but reads it back
// one byte per character (so anything else comes back mangled), bytes 1-7 would
// be read as key actions, and QMK's send_string only types ASCII.

import { useState } from "react";
import { macrosExtension, type Macros } from "../../core/extensions/macros.ts";
import { VIAL_PROTOCOL_ADVANCED_MACROS, VIAL_PROTOCOL_EXT_MACROS } from "../../core/protocol/constants.ts";
import { equalBytes, MACRO_MAX_DELAY_UI, type MacroAction } from "../../core/protocol/macros.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./macros.css";

type ActionType = MacroAction["type"];

interface DraftAction {
  id: number;
  type: ActionType;
  text: string;
  keys: string[];
  delay: string;
}

const TYPE_LABELS: Record<ActionType, string> = {
  text: "Text",
  down: "Down",
  up: "Up",
  tap: "Tap",
  delay: "Delay (ms)",
};

/** Error for a typed keycode, or null when it is valid for this board. */
function keycodeError(keyboard: Keyboard, value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a keycode";
  let code: number;
  try {
    code = keyboard.keycodes.parse(v);
  } catch (err) {
    return errorMessage(err);
  }
  if (keyboard.vialProtocol < VIAL_PROTOCOL_EXT_MACROS && !keyboard.keycodes.isBasic(code)) {
    return "Only basic keycodes work in macros on this firmware (Vial protocol below 5)";
  }
  return null;
}

function textError(value: string): string | null {
  return /[^\x20-\x7e]/.test(value) ? "Only plain ASCII characters can be typed by a macro" : null;
}

function delayError(value: string): string | null {
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n) || n < 0 || n > MACRO_MAX_DELAY_UI) {
    return `Enter a whole number of milliseconds from 0 to ${MACRO_MAX_DELAY_UI}`;
  }
  return null;
}

// Stable React keys for draft actions; never shown.
let lastActionId = 0;
const newActionId = () => ++lastActionId;

function toDraft(macros: MacroAction[][]): DraftAction[][] {
  return macros.map((m) =>
    m.map((a) => ({
      id: newActionId(),
      type: a.type,
      text: a.type === "text" ? a.text : "",
      keys: a.type === "text" || a.type === "delay" ? [] : a.keys.map(String),
      delay: a.type === "delay" ? String(a.delay) : "0",
    })),
  );
}

function toAction(d: DraftAction): MacroAction {
  if (d.type === "text") return { type: "text", text: d.text };
  if (d.type === "delay") {
    const n = Number(d.delay);
    return { type: "delay", delay: delayError(d.delay) ? 0 : n };
  }
  return { type: d.type, keys: d.keys.map((k) => k.trim()) };
}

function MacrosPanel({ keyboard, onError, onNotice }: PanelProps) {
  useKeyboardVersion(keyboard);
  const macros = keyboard.extension(macrosExtension);
  if (!macros) return null;
  return <MacroEditor keyboard={keyboard} macros={macros} onError={onError} onNotice={onNotice} />;
}

function MacroEditor({ keyboard, macros, onError, onNotice }: PanelProps & { macros: Macros }) {
  const [base, setBase] = useState(macros.buffer);
  const [draft, setDraft] = useState(() => toDraft(macros.macros));
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  // The board's macros changed elsewhere (save, revert, .vil restore): start over from them.
  if (base !== macros.buffer) {
    setBase(macros.buffer);
    setDraft(toDraft(macros.macros));
  }

  const withDelay = keyboard.vialProtocol >= VIAL_PROTOCOL_ADVANCED_MACROS;
  const types: ActionType[] = withDelay
    ? ["text", "down", "up", "tap", "delay"]
    : ["text", "down", "up", "tap"];

  const actions = draft.map((m) => m.map(toAction));
  const data = macros.serialize(actions);
  const pieces = macros.pieces;
  const modified = actions.map((m, i) => !equalBytes(macros.serializeMacro(m), pieces[i]));
  const invalid = draft.some((m) =>
    m.some((a) =>
      a.type === "delay"
        ? delayError(a.delay) !== null
        : a.type === "text"
          ? textError(a.text) !== null
          : a.keys.some((k) => keycodeError(keyboard, k) !== null),
    ),
  );
  const over = data.length > macros.memory;
  const unchanged = equalBytes(data, macros.buffer);

  const current = draft[selected] ?? [];
  const update = (fn: (m: DraftAction[]) => DraftAction[]) =>
    setDraft((d) => d.map((m, i) => (i === selected ? fn(m) : m)));
  const patch = (id: number, change: Partial<DraftAction>) =>
    update((m) => m.map((a) => (a.id === id ? { ...a, ...change } : a)));
  const add = (a: Omit<DraftAction, "id">) => update((m) => [...m, { ...a, id: newActionId() }]);
  const move = (index: number, offset: number) =>
    update((m) => {
      const to = index + offset;
      if (to < 0 || to >= m.length) return m;
      const out = [...m];
      [out[index], out[to]] = [out[to], out[index]];
      return out;
    });

  const run = async (fn: () => Promise<void>, notice: string) => {
    setBusy(true);
    try {
      await fn();
      onNotice(notice);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="macros">
      <div className="macro-tabs" role="tablist" aria-label="Macros">
        {draft.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === selected}
            className={i === selected ? "active" : ""}
            onClick={() => setSelected(i)}
            title={modified[i] ? "Unsaved changes" : undefined}
          >
            M{i}
            {modified[i] ? "*" : ""}
          </button>
        ))}
      </div>

      <section className="macro-body" aria-label={`Macro M${selected}`}>
        {current.length === 0 ? <p className="hint">M{selected} is empty. Add an action below.</p> : null}
        <ol className="macro-actions">
          {current.map((a, index) => {
            const n = index + 1;
            return (
              <li key={a.id} className="macro-action">
                <span className="macro-move">
                  <button
                    type="button"
                    aria-label={`Move action ${n} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move action ${n} down`}
                    disabled={index === current.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ▼
                  </button>
                </span>
                <select
                  aria-label={`Action ${n} type`}
                  value={a.type}
                  onChange={(e) =>
                    // A fresh action of the new type, as MacroLine.on_change_type does.
                    patch(a.id, { type: e.target.value as ActionType, text: "", keys: [], delay: "0" })
                  }
                >
                  {(types.includes(a.type) ? types : [...types, a.type]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <ActionValue
                  keyboard={keyboard}
                  action={a}
                  n={n}
                  onChange={(change) => patch(a.id, change)}
                />
                <button
                  type="button"
                  className="macro-remove"
                  aria-label={`Remove action ${n}`}
                  onClick={() => update((m) => m.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <div className="macro-add">
          <button type="button" onClick={() => add({ type: "text", text: "", keys: [], delay: "0" })}>
            Add action
          </button>
          <button
            type="button"
            onClick={() => add({ type: "tap", text: "", keys: ["KC_ENTER"], delay: "0" })}
          >
            Tap Enter
          </button>
        </div>
      </section>

      <footer className="macro-footer">
        <span role="status" className={over ? "error" : "hint"}>
          Memory used by macros: {data.length}/{macros.memory}
          {over ? " — too much to save" : ""}
        </span>
        <span className="macro-buttons">
          <button
            type="button"
            className="primary"
            disabled={busy || unchanged || over || invalid}
            onClick={() => void run(() => macros.setMacros(actions), "Macros saved to the keyboard.")}
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => macros.reload(), "Macros reloaded from the keyboard.")}
          >
            Revert
          </button>
        </span>
      </footer>
    </div>
  );
}

function ActionValue({
  keyboard,
  action,
  n,
  onChange,
}: {
  keyboard: Keyboard;
  action: DraftAction;
  n: number;
  onChange: (change: Partial<DraftAction>) => void;
}) {
  if (action.type === "text") {
    const error = textError(action.text);
    return (
      <span className="macro-value">
        <input
          className="macro-text"
          aria-label={`Action ${n} text`}
          aria-invalid={error !== null}
          value={action.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {error ? <span className="error">{error}</span> : null}
      </span>
    );
  }
  if (action.type === "delay") {
    const error = delayError(action.delay);
    return (
      <span className="macro-value">
        <input
          type="number"
          min={0}
          max={MACRO_MAX_DELAY_UI}
          aria-label={`Action ${n} delay (ms)`}
          aria-invalid={error !== null}
          value={action.delay}
          onChange={(e) => onChange({ delay: e.target.value })}
        />
        {error ? <span className="error">{error}</span> : null}
      </span>
    );
  }
  const setKeys = (keys: string[]) => onChange({ keys });
  return (
    <span className="macro-value macro-keys">
      {action.keys.map((key, k) => {
        const error = keycodeError(keyboard, key);
        const id = `macro-action-${action.id}-key-${k}`;
        return (
          <span key={k} className="macro-key">
            <input
              aria-label={`Action ${n} key ${k + 1}`}
              aria-invalid={error !== null}
              aria-describedby={error ? `${id}-error` : undefined}
              spellCheck={false}
              value={key}
              onChange={(e) => setKeys(action.keys.map((x, i) => (i === k ? e.target.value : x)))}
            />
            <button
              type="button"
              aria-label={`Remove key ${k + 1} from action ${n}`}
              onClick={() => setKeys(action.keys.filter((_, i) => i !== k))}
            >
              ×
            </button>
            {error ? (
              <span id={`${id}-error`} className="error">
                {error}
              </span>
            ) : null}
          </span>
        );
      })}
      <button
        type="button"
        aria-label={`Add key to action ${n}`}
        onClick={() => setKeys([...action.keys, "KC_TRNS"])}
      >
        +
      </button>
    </span>
  );
}

export const macrosUi: AppExtension = {
  id: macrosExtension.id,
  panels: [{ id: "macros", title: "Macros", Component: MacrosPanel }],
};
