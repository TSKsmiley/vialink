// SPDX-License-Identifier: GPL-2.0-or-later
// React side of the undo history (src/core/history.ts): state for the
// Undo/Redo buttons, undo/redo actions that report errors, and the global
// Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) shortcuts.

import { useCallback, useEffect, useState } from "react";
import type { History } from "../../core/history.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage } from "../hooks.ts";

export interface HistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  undo(): void;
  redo(): void;
}

const NONE: History | null = null;

/** Re-renders on every history change of this keyboard. */
function useHistoryVersion(history: History | null): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!history) return;
    return history.subscribe(() => setVersion((v) => v + 1));
  }, [history]);
  return version;
}

export function useHistory(keyboard: Keyboard | null, onError: (message: string) => void): HistoryControls {
  const history = keyboard?.history ?? NONE;
  useHistoryVersion(history);

  const undo = useCallback(() => {
    if (!history || history.busy) return;
    void history.undo().catch((err) => onError(errorMessage(err)));
  }, [history, onError]);
  const redo = useCallback(() => {
    if (!history || history.busy) return;
    void history.redo().catch((err) => onError(errorMessage(err)));
  }, [history, onError]);

  // Ask before overwriting a value that changed since it was recorded.
  useEffect(() => {
    if (!history) return;
    history.setConfirmStale(async (entry, action) =>
      window.confirm(
        `“${entry.label}” was changed again since. ${action === "undo" ? "Undo" : "Redo"} it anyway and overwrite the newer value?`,
      ),
    );
    return () => history.setConfirmStale(null);
  }, [history]);

  useEffect(() => {
    if (!history) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      if (!isUndo && !isRedo) return;
      // Text fields keep their own undo.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        const type = (t as HTMLInputElement).type;
        if (t.tagName !== "INPUT" || !["checkbox", "radio", "range", "button"].includes(type)) return;
      }
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, undo, redo]);

  return {
    canUndo: !!history?.canUndo && !history.busy,
    canRedo: !!history?.canRedo && !history.busy,
    undoLabel: history?.nextUndo?.label ?? null,
    redoLabel: history?.nextRedo?.label ?? null,
    busy: !!history?.busy,
    undo,
    redo,
  };
}
