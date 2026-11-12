// SPDX-License-Identifier: GPL-2.0-or-later
// The editor area: the section sidebar, and beside it the keymap (layer tabs,
// keyboard view, keycode picker, layout options), the matrix tester or an
// extension's view. Loading and saving layouts lives in the top bar (VilControls).

import { useState, type ReactNode } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { activeUi } from "../extensions/registry.tsx";
import { MatrixTester } from "./MatrixTester.tsx";
import { errorMessage, useKeyboardVersion, pickerInfoOf } from "../hooks.ts";
import { KeyboardView, type Selection } from "./KeyboardView.tsx";
import { KeycodePicker } from "./KeycodePicker.tsx";
import { LayoutOptionsPanel } from "./LayoutOptionsPanel.tsx";
import { Sidebar, type Section } from "../shell/Sidebar.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** True while something outside the editor writes to the board (a layout restore). */
  locked?: boolean;
}

export function Editor({ keyboard, onError, onNotice, locked = false }: Props) {
  useKeyboardVersion(keyboard);
  const [layer, setLayer] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [writing, setBusy] = useState(false);
  const busy = writing || locked;
  const [view, setView] = useState("keymap");

  const current =
    selection?.kind === "key"
      ? (keyboard.getKey(layer, selection.row, selection.col) ?? null)
      : selection?.kind === "encoder"
        ? (keyboard.getEncoder(layer, selection.index, selection.direction) ?? null)
        : null;

  /** Like vial-gui: picking a basic keycode for a masked key (e.g. LSFT(kc)) fills in its inner key. */
  const resolvePick = (code: number): number => {
    const table = keyboard.keycodes;
    if (current !== null && table.isMasked(current) && table.isBasic(code)) return (current & 0xff00) | code;
    return code;
  };

  /** Selects the next key in visual order after an assignment, as vial-gui does. */
  const advance = (sel: Selection) => {
    if (sel?.kind !== "key") return;
    const order = [...keyboard.keys]
      .filter((k) => k.layoutIndex === -1 || keyboard.layoutChoices[k.layoutIndex] === k.layoutOption)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const i = order.findIndex((k) => k.row === sel.row && k.col === sel.col);
    const next = order[i + 1];
    setSelection(next ? { kind: "key", row: next.row, col: next.col } : null);
  };

  const pick = async (code: number) => {
    if (!selection || busy) return;
    const value = resolvePick(code);
    const keepMaskedSelection =
      current !== null && keyboard.keycodes.isMasked(value) && !keyboard.keycodes.isMasked(current);
    setBusy(true);
    try {
      if (selection.kind === "key") await keyboard.setKey(layer, selection.row, selection.col, value);
      else await keyboard.setEncoder(layer, selection.index, selection.direction, value);
      // After choosing a masked keycode, keep the key selected so its inner key can be picked next.
      if (!keepMaskedSelection) advance(selection);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setLayout = async (choices: number[]) => {
    setBusy(true);
    try {
      await keyboard.setLayoutChoices(choices);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const extensionUi = activeUi(keyboard);
  const layerName = (l: number) => {
    for (const ui of extensionUi) {
      const label = ui.layerTabLabel?.(keyboard, l);
      if (label) return label;
    }
    return String(l);
  };

  const panels = extensionUi.flatMap((ui) => ui.panels ?? []);
  const sections: Section[] = [
    { id: "keymap", title: "Keymap", group: "edit" },
    ...panels.map((p) => ({ id: p.id, title: p.title, group: "edit" as const, count: p.count?.(keyboard) })),
    { id: "matrix", title: "Matrix tester", group: "tools" },
  ];
  // A view whose extension was just turned off falls back to the keymap.
  const shown = sections.some((v) => v.id === view) ? view : "keymap";
  const panel = panels.find((p) => p.id === shown);

  const frame = (content: ReactNode) => (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <Sidebar sections={sections} current={shown} onSelect={setView} />
      <div
        role="tabpanel"
        aria-label={sections.find((v) => v.id === shown)?.title}
        className="editor legacy-view min-w-0 flex-1 p-4 md:p-5"
      >
        {content}
      </div>
    </div>
  );

  if (shown === "matrix") return frame(<MatrixTester keyboard={keyboard} onError={onError} />);
  if (panel) return frame(<panel.Component keyboard={keyboard} onError={onError} onNotice={onNotice} />);

  return frame(
    <>
      <div className="toolbar">
        <div className="layers" role="tablist" aria-label="Layers">
          <span>Layer</span>
          {Array.from({ length: keyboard.layers }, (_, l) => (
            <button
              key={l}
              role="tab"
              aria-selected={layer === l}
              className={layer === l ? "active" : ""}
              onClick={() => setLayer(l)}
            >
              {layerName(l)}
            </button>
          ))}
          {extensionUi.map((ui) =>
            ui.LayerActions ? (
              <ui.LayerActions key={ui.id} keyboard={keyboard} layer={layer} onError={onError} />
            ) : null,
          )}
        </div>
      </div>

      <div className="board-wrap">
        <KeyboardView keyboard={keyboard} layer={layer} selection={selection} onSelect={setSelection} />
      </div>

      <LayoutOptionsPanel keyboard={keyboard} onChange={(c) => void setLayout(c)} busy={busy} />

      <KeycodePicker
        info={pickerInfoOf(keyboard)}
        table={keyboard.keycodes}
        disabled={selection === null || busy}
        current={current}
        onPick={(c) => void pick(c)}
      />
    </>,
  );
}
