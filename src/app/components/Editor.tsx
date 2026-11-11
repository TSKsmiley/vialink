// SPDX-License-Identifier: GPL-2.0-or-later
// Keymap editor: layer tabs, keyboard view, keycode picker and layout options.

import { useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { activeUi } from "../extensions/registry.tsx";
import { MatrixTester } from "./MatrixTester.tsx";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KeyboardView, type Selection } from "./KeyboardView.tsx";
import { KeycodePicker } from "./KeycodePicker.tsx";
import { LayoutOptionsPanel } from "./LayoutOptionsPanel.tsx";
import { VilControls } from "./VilControls.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function Editor({ keyboard, onError, onNotice }: Props) {
  useKeyboardVersion(keyboard);
  const [layer, setLayer] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [busy, setBusy] = useState(false);
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
  const views = [
    { id: "keymap", title: "Keymap" },
    { id: "matrix", title: "Matrix tester" },
    ...panels.map((p) => ({ id: p.id, title: p.title })),
  ];
  const panel = panels.find((p) => p.id === view);

  const viewTabs = (
    <nav className="views" role="tablist" aria-label="Editor views">
      {views.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          className={view === v.id ? "active" : ""}
          onClick={() => setView(v.id)}
        >
          {v.title}
        </button>
      ))}
    </nav>
  );

  if (view === "matrix") {
    return (
      <div className="editor">
        {viewTabs}
        <MatrixTester keyboard={keyboard} onError={onError} />
      </div>
    );
  }
  if (panel) {
    return (
      <div className="editor">
        {viewTabs}
        <panel.Component keyboard={keyboard} onError={onError} onNotice={onNotice} />
      </div>
    );
  }

  return (
    <div className="editor">
      {viewTabs}
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
        <VilControls
          keyboard={keyboard}
          busy={busy}
          setBusy={setBusy}
          onError={onError}
          onNotice={onNotice}
        />
      </div>

      <div className="board-wrap">
        <KeyboardView keyboard={keyboard} layer={layer} selection={selection} onSelect={setSelection} />
      </div>

      <LayoutOptionsPanel keyboard={keyboard} onChange={(c) => void setLayout(c)} busy={busy} />

      <KeycodePicker
        table={keyboard.keycodes}
        disabled={selection === null || busy}
        current={current}
        onPick={(c) => void pick(c)}
      />
    </div>
  );
}
