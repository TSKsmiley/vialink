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
// Deviations (design board 4): a list of the macros in use and one in detail;
// steps read as words (Type, Tap, Hold, Release, Wait) with drag handles and a
// "Plays as" line; a key is selected in a step, then found by name, shortcut
// or expression (vial-gui opens a picker popup per key); "+" and the "Add a
// step" buttons select the key they add. Edits can be undone step by step
// (Undo step, Ctrl+Z) until Save; Save is one entry in the keyboard's undo
// history. There is no keystroke recorder (a web page cannot capture
// system-wide keystrokes) and no JSON text editor. Save also
// needs every keycode and delay to be valid, and
// text to be printable ASCII: vial-gui writes text as UTF-8 but reads it back
// one byte per character (so anything else comes back mangled), bytes 1-7 would
// be read as key actions, and QMK's send_string only types ASCII.

import { useEffect, useState } from "react";
import { macrosExtension, type Macros } from "../../core/extensions/macros.ts";
import { VIAL_PROTOCOL_ADVANCED_MACROS, VIAL_PROTOCOL_EXT_MACROS } from "../../core/protocol/constants.ts";
import { equalBytes, MACRO_MAX_DELAY_UI, type MacroAction } from "../../core/protocol/macros.ts";
import type { BoardView, DeviceContext } from "../../core/extensions/types.ts";
import { errorMessage } from "../hooks.ts";
import { KeySearch, keyText } from "../keymap/KeySearch.tsx";
import { Button } from "../ui/index.ts";
import { DetailCard, EntryList, FeatureLayout, placedText } from "./featureLayout.tsx";
import type { PanelKit } from "./kit.tsx";
import { panel, type AppExtension, type PanelProps } from "./registry.tsx";

type ActionType = MacroAction["type"];

interface DraftAction {
  id: number;
  type: ActionType;
  text: string;
  keys: string[];
  delay: string;
}

/** A selected key: which action, and which key in it. */
interface KeySlot {
  action: number;
  key: number;
}

/** The keycode a key string stands for, or null when it does not parse. */
function keycodeOf(board: BoardView, value: string): number | null {
  try {
    return board.keycodes.parse(value.trim());
  } catch {
    return null;
  }
}

/** Error for a keycode, or null when it is valid for this board. */
function keycodeError(board: BoardView, value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a keycode";
  let code: number;
  try {
    code = board.keycodes.parse(v);
  } catch (err) {
    return errorMessage(err);
  }
  if (board.vialProtocol < VIAL_PROTOCOL_EXT_MACROS && !board.keycodes.isBasic(code)) {
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

function MacrosPanel({ ctx, state, ui }: PanelProps<Macros>) {
  return <MacroEditor ctx={ctx} ui={ui} macros={state} />;
}

/** A step in words: "Type “hi”", "Tap Ctrl + C", "Hold Shift", "Wait 100 ms". */
function stepWords(board: BoardView, a: MacroAction): string {
  if (a.type === "text") return `type “${a.text}”`;
  if (a.type === "delay") return `wait ${a.delay} ms`;
  const keys = a.keys
    .map((k) => {
      const code = typeof k === "number" ? k : keycodeOf(board, k);
      return code === null ? String(k) : keyText(board.keycodes, code);
    })
    .join(" + ");
  return a.type === "tap" ? keys : `${a.type === "down" ? "hold" : "release"} ${keys}`;
}

/** The whole macro in words: "Home, hold Shift, End, release Shift, Ctrl + C". */
function playsAs(board: BoardView, actions: readonly MacroAction[]): string {
  return actions.length ? actions.map((a) => stepWords(board, a)).join(", ") : "Nothing yet";
}

const VERBS: Record<ActionType, string> = {
  text: "Type",
  tap: "Tap",
  down: "Hold",
  up: "Release",
  delay: "Wait",
};

/** How many draft states the step-level undo keeps. */
const STEP_UNDO_LIMIT = 100;

function MacroEditor({ ctx, ui, macros }: { ctx: DeviceContext; ui: PanelKit; macros: Macros }) {
  const board = ctx.board;
  const { error: onError, info: onNotice } = ctx.notify;
  const [base, setBase] = useState(macros.buffer);
  const [draft, setDraftState] = useState(() => toDraft(macros.macros));
  const [past, setPast] = useState<DraftAction[][][]>([]);
  const [future, setFuture] = useState<DraftAction[][][]>([]);
  const [selected, setSelected] = useState(() => {
    const first = macros.pieces.findIndex((p) => p.length > 0);
    return first === -1 ? 0 : first;
  });
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<KeySlot | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  // The board's macros changed elsewhere (save, revert, undo, .vil restore): start over from them.
  if (base !== macros.buffer) {
    setBase(macros.buffer);
    setDraftState(toDraft(macros.macros));
    setPast([]);
    setFuture([]);
    setSlot(null);
  }

  /** Every edit goes through here, so the editor can undo it step by step until Save. */
  const setDraft = (next: DraftAction[][] | ((d: DraftAction[][]) => DraftAction[][])) => {
    setDraftState((d) => {
      const value = typeof next === "function" ? next(d) : next;
      if (value !== d) {
        setPast((p) => [...p.slice(-STEP_UNDO_LIMIT + 1), d]);
        setFuture([]);
      }
      return value;
    });
  };
  const undoStep = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setFuture((f) => [draft, ...f]);
    setPast((p) => p.slice(0, -1));
    setDraftState(prev);
    setSlot(null);
  };
  const redoStep = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, draft]);
    setFuture((f) => f.slice(1));
    setDraftState(next);
    setSlot(null);
  };

  const withDelay = board.vialProtocol >= VIAL_PROTOCOL_ADVANCED_MACROS;
  const types: ActionType[] = withDelay
    ? ["text", "tap", "down", "up", "delay"]
    : ["text", "tap", "down", "up"];

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
          : a.keys.some((k) => keycodeError(board, k) !== null),
    ),
  );
  const over = data.length > macros.memory;
  const unchanged = equalBytes(data, macros.buffer);

  // While there are unsaved edits, Ctrl+Z / Ctrl+Shift+Z undo and redo steps of
  // the macro; after Save they undo the saved macro on the keyboard (the global history).
  useEffect(() => {
    if (unchanged) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) redoStep();
      else undoStep();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const current = draft[selected] ?? [];
  const update = (fn: (m: DraftAction[]) => DraftAction[]) =>
    setDraft((d) => d.map((m, i) => (i === selected ? fn(m) : m)));
  const patch = (id: number, change: Partial<DraftAction>) =>
    update((m) => m.map((a) => (a.id === id ? { ...a, ...change } : a)));
  const add = (a: Omit<DraftAction, "id">) => {
    const id = newActionId();
    update((m) => [...m, { ...a, id }]);
    return id;
  };
  const moveTo = (from: number, to: number) =>
    update((m) => {
      if (to < 0 || to >= m.length || from === to) return m;
      const out = [...m];
      const [item] = out.splice(from, 1);
      out.splice(to, 0, item);
      return out;
    });

  const slotAction = slot ? current.find((a) => a.id === slot.action) : undefined;
  const slotKey = slot && slotAction ? slotAction.keys[slot.key] : undefined;
  const table = board.keycodes;
  const pick = (code: number) => {
    if (!slot || !slotAction || slotKey === undefined) return;
    patch(slotAction.id, {
      keys: slotAction.keys.map((k, i) => (i === slot.key ? table.serialize(code) : k)),
    });
    setSlot(null);
  };

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

  const used = draft.flatMap((m, i) => (m.length > 0 || pieces[i].length > 0 || modified[i] ? [i] : []));
  const shown = used.includes(selected) ? used : [...used, selected].sort((a, b) => a - b);
  const free = draft.findIndex((m, i) => m.length === 0 && pieces[i].length === 0 && i !== selected);
  const macroCode = (i: number) => {
    try {
      return table.parse(`M${i}`);
    } catch {
      return -1;
    }
  };
  const places = ui.placementsOf(macroCode(selected));
  const percent = Math.min(100, Math.round((data.length / macros.memory) * 100));

  return (
    <FeatureLayout
      list={
        <EntryList
          title="Macros"
          used={`${draft.filter((m) => m.length > 0).length} of ${macros.count} used`}
          description="Steps the keyboard types or presses for you, from one key."
          extra={
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-kumo-tint" aria-hidden="true">
                <div
                  className={"h-full rounded-full " + (over ? "bg-kumo-danger" : "bg-accent")}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span role="status" className={"text-xs " + (over ? "text-kumo-danger" : "text-kumo-subtle")}>
                Memory used by macros: {data.length}/{macros.memory} bytes
                {over ? " — too much to save" : ""}
              </span>
            </div>
          }
          items={shown.map((i) => ({
            id: i,
            title: `M${i}${modified[i] ? "*" : ""}`,
            meta: modified[i] ? "unsaved" : placedText(ui.placementsOf(macroCode(i))),
            summary: playsAs(board, actions[i]),
          }))}
          selected={selected}
          onSelect={(i) => {
            setSelected(i);
            setSlot(null);
          }}
          newLabel="New macro"
          onNew={
            free === -1
              ? undefined
              : () => {
                  setSelected(free);
                  setSlot(null);
                }
          }
        />
      }
      detail={
        <DetailCard label={`Macro M${selected}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="m-0 text-lg font-semibold">M{selected}</h2>
            <span className="text-sm text-kumo-subtle">
              {places.length
                ? `Placed on ${places.join("; ")}`
                : "Not on any key yet: use the Macro tab of the key inspector"}
            </span>
            <div className="flex-1" />
            {!unchanged && <span className="text-sm text-accent-link">Unsaved changes</span>}
            <div role="group" aria-label="Macro edits" className="inline-flex gap-1">
              <Button
                size="sm"
                disabled={past.length === 0}
                onClick={undoStep}
                title="Undo the last step change (Ctrl+Z)"
              >
                Undo step
              </Button>
              <Button size="sm" disabled={future.length === 0} onClick={redoStep} title="Redo (Ctrl+Shift+Z)">
                Redo step
              </Button>
            </div>
            <Button
              disabled={busy || unchanged}
              onClick={() => {
                setDraft(toDraft(macros.macros));
                setSlot(null);
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              disabled={busy || unchanged || over || invalid}
              onClick={() =>
                void run(async () => {
                  await macros.setMacros(actions);
                  setPast([]);
                  setFuture([]);
                }, "Macros saved to the keyboard.")
              }
            >
              Save to keyboard
            </Button>
          </div>

          {current.length === 0 ? (
            <p className="m-0 text-kumo-subtle">M{selected} is empty. Add a step below.</p>
          ) : (
            <ol className="macro-steps m-0 flex list-none flex-col gap-2 p-0">
              {current.map((a, index) => {
                const n = index + 1;
                return (
                  <li
                    key={a.id}
                    className={
                      "flex flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2 " +
                      (dragFrom === index ? "border-dashed border-accent" : "border-kumo-line bg-kumo-base")
                    }
                    onDragOver={(e) => {
                      if (dragFrom !== null) e.preventDefault();
                    }}
                    onDrop={() => {
                      if (dragFrom !== null) moveTo(dragFrom, index);
                      setDragFrom(null);
                    }}
                  >
                    <span
                      draggable
                      onDragStart={() => setDragFrom(index)}
                      onDragEnd={() => setDragFrom(null)}
                      aria-hidden="true"
                      title="Drag to move"
                      className="cursor-grab px-1 text-kumo-subtle select-none"
                    >
                      ⠿
                    </span>
                    <span className="inline-flex flex-col">
                      <button
                        type="button"
                        aria-label={`Move action ${n} up`}
                        disabled={index === 0}
                        onClick={() => moveTo(index, index - 1)}
                        className="cursor-pointer px-1 text-[10px] leading-none text-kumo-subtle disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Move action ${n} down`}
                        disabled={index === current.length - 1}
                        onClick={() => moveTo(index, index + 1)}
                        className="cursor-pointer px-1 text-[10px] leading-none text-kumo-subtle disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </span>
                    <select
                      aria-label={`Action ${n} type`}
                      value={a.type}
                      onChange={(e) => {
                        // A fresh action of the new type, as MacroLine.on_change_type does.
                        patch(a.id, { type: e.target.value as ActionType, text: "", keys: [], delay: "0" });
                        if (slot?.action === a.id) setSlot(null);
                      }}
                      className="min-h-8 rounded-md border border-kumo-line bg-kumo-control px-1.5 text-sm font-semibold"
                    >
                      {(types.includes(a.type) ? types : [...types, a.type]).map((t) => (
                        <option key={t} value={t}>
                          {VERBS[t]}
                        </option>
                      ))}
                    </select>
                    <ActionValue
                      board={board}
                      action={a}
                      n={n}
                      onChange={(change) => patch(a.id, change)}
                      selectedKey={slot?.action === a.id ? slot.key : null}
                      onSelectKey={(key) =>
                        setSlot(
                          key === null || (slot?.action === a.id && slot.key === key)
                            ? null
                            : { action: a.id, key },
                        )
                      }
                    />
                    <div className="flex-1" />
                    <button
                      type="button"
                      aria-label={`Remove action ${n}`}
                      onClick={() => {
                        update((m) => m.filter((x) => x.id !== a.id));
                        if (slot?.action === a.id) setSlot(null);
                      }}
                      className="cursor-pointer rounded px-2 text-kumo-subtle hover:text-kumo-default"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {slot && slotAction && slotKey !== undefined && (
            <KeySearch
              table={table}
              label={`Choose key ${slot.key + 1} of step ${current.indexOf(slotAction) + 1}`}
              disabled={busy}
              basicOnly={board.vialProtocol < VIAL_PROTOCOL_EXT_MACROS}
              onPick={pick}
            />
          )}

          <div className="flex flex-col gap-2 border-t border-kumo-line pt-4">
            <strong>Add a step</strong>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [
                    "Type text",
                    "ASCII letters and symbols",
                    { type: "text", text: "", keys: [], delay: "0" },
                  ],
                  [
                    "Press keys",
                    "A shortcut, like Ctrl+C",
                    { type: "tap", text: "", keys: ["KC_NO"], delay: "0" },
                  ],
                  ["Hold", "Keep a key down…", { type: "down", text: "", keys: ["KC_NO"], delay: "0" }],
                  ["Release", "…and let it go", { type: "up", text: "", keys: ["KC_NO"], delay: "0" }],
                  ...(withDelay
                    ? [
                        [
                          "Wait",
                          "Pause in milliseconds",
                          { type: "delay", text: "", keys: [], delay: "100" },
                        ] as const,
                      ]
                    : []),
                ] as const
              ).map(([label, hint, a]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    const id = add({ ...a, keys: [...a.keys] });
                    if (a.keys.length) setSlot({ action: id, key: 0 });
                  }}
                  className="flex min-h-11 cursor-pointer flex-col items-start rounded-lg border border-kumo-line px-3 py-1.5 text-left hover:bg-kumo-tint"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[11px] text-kumo-subtle">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-2 rounded-lg bg-kumo-tint px-3 py-2 text-sm">
            <span className="text-kumo-subtle">Plays as</span>
            <span>{playsAs(board, actions[selected] ?? [])}</span>
          </div>
        </DetailCard>
      }
    />
  );
}

function ActionValue({
  board,
  action,
  n,
  onChange,
  selectedKey,
  onSelectKey,
}: {
  board: BoardView;
  action: DraftAction;
  n: number;
  onChange: (change: Partial<DraftAction>) => void;
  selectedKey: number | null;
  /** Selects key `key` (toggling it off when already selected), or clears the selection with null. */
  onSelectKey: (key: number | null) => void;
}) {
  const input = "rounded-md border border-kumo-line bg-kumo-control px-2 py-1";
  if (action.type === "text") {
    const error = textError(action.text);
    return (
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          className={input + " w-full"}
          aria-label={`Action ${n} text`}
          aria-invalid={error !== null}
          value={action.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {error ? <span className="text-xs text-kumo-danger">{error}</span> : null}
      </span>
    );
  }
  if (action.type === "delay") {
    const error = delayError(action.delay);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={MACRO_MAX_DELAY_UI}
          aria-label={`Action ${n} delay (ms)`}
          aria-invalid={error !== null}
          value={action.delay}
          onChange={(e) => onChange({ delay: e.target.value })}
          className={input + " w-24 text-right font-mono"}
        />
        <span className="text-sm text-kumo-subtle">ms</span>
        {error ? <span className="text-xs text-kumo-danger">{error}</span> : null}
      </span>
    );
  }
  const setKeys = (keys: string[]) => onChange({ keys });
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {action.keys.map((key, k) => {
        const error = keycodeError(board, key);
        const id = `macro-action-${action.id}-key-${k}`;
        const code = keycodeOf(board, key);
        const text = code === null ? key : keyText(board.keycodes, code);
        return (
          <span key={k} className="inline-flex items-center gap-0.5">
            {k > 0 && <span className="px-0.5 text-kumo-subtle">+</span>}
            <button
              type="button"
              aria-label={`Action ${n} key ${k + 1}: ${key}`}
              aria-pressed={selectedKey === k}
              aria-invalid={error !== null}
              aria-describedby={error ? `${id}-error` : undefined}
              title={code === null ? key : (board.keycodes.label(code).tooltip ?? key)}
              onClick={() => onSelectKey(k)}
              className={
                "min-h-8 cursor-pointer rounded-md border px-2 text-sm " +
                (selectedKey === k
                  ? "border-accent bg-accent-tint"
                  : error
                    ? "border-kumo-danger"
                    : "border-kumo-line bg-kumo-tint")
              }
            >
              {code === 0 ? "choose…" : text || " "}
            </button>
            <button
              type="button"
              aria-label={`Remove key ${k + 1} from action ${n}`}
              onClick={() => {
                setKeys(action.keys.filter((_, i) => i !== k));
                if (selectedKey !== null && selectedKey >= k) onSelectKey(null);
              }}
              className="cursor-pointer px-1 text-xs text-kumo-subtle hover:text-kumo-default"
            >
              ×
            </button>
            {error ? (
              <span id={`${id}-error`} className="text-xs text-kumo-danger">
                {error}
              </span>
            ) : null}
          </span>
        );
      })}
      <button
        type="button"
        aria-label={`Add key to action ${n}`}
        onClick={() => {
          setKeys([...action.keys, "KC_NO"]);
          onSelectKey(action.keys.length);
        }}
        className="min-h-8 cursor-pointer rounded-md border border-dashed border-kumo-line px-2 text-sm text-kumo-subtle"
      >
        +
      </button>
    </span>
  );
}

export const macrosUi: AppExtension = {
  id: macrosExtension.id,
  panels: [
    panel<Macros>({
      id: "macros",
      modern: true,
      title: "Macros",
      Component: MacrosPanel,
      count: (macros) => macros.pieces.filter((p) => p.length > 0).length,
    }),
  ],
};
