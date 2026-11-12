// SPDX-License-Identifier: GPL-2.0-or-later
// The toast after each change (design boards 1-4): what changed, with Undo.
// After an undo it offers Redo. Hides after a few seconds, or on Escape;
// Ctrl+Z works whether or not it is showing.

import { useEffect, useState } from "react";
import type { HistoryEvent } from "../../core/history.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { Button } from "../ui/index.ts";
import type { HistoryControls } from "./useHistory.ts";

const SHOW_MS = 6000;

export function UndoToast({ keyboard, controls }: { keyboard: Keyboard | null; controls: HistoryControls }) {
  const [shown, setShown] = useState<HistoryEvent | null>(null);

  useEffect(() => {
    if (!keyboard) return;
    return keyboard.history.subscribe((e) => {
      if (e) setShown(e);
    });
  }, [keyboard]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), SHOW_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShown(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  if (!shown || !keyboard) return null;
  const undone = shown.kind === "undone";
  const text = undone ? `Undid: ${shown.entry.label}` : shown.entry.label;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-kumo-line bg-kumo-overlay px-3.5 py-2.5 shadow-lg"
    >
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
      {undone ? (
        <Button size="sm" variant="outline" disabled={!controls.canRedo} onClick={controls.redo}>
          Redo
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={!controls.canUndo} onClick={controls.undo}>
          Undo
        </Button>
      )}
      <span className="text-xs text-kumo-subtle max-sm:hidden">{undone ? "Ctrl+Shift+Z" : "Ctrl+Z"}</span>
    </div>
  );
}
