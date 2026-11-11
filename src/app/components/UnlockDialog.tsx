// SPDX-License-Identifier: GPL-2.0-or-later
// The unlock dialog of vial-gui's unlocker.py: shows which keys to hold,
// fills a progress bar while they are held, and closes once the board reports
// itself unlocked. Unlike vial-gui it can be cancelled.

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { runUnlock, type UnlockProgress } from "../../core/unlock.ts";
import { errorMessage } from "../hooks.ts";
import { KeyboardView } from "./KeyboardView.tsx";

interface Props {
  keyboard: Keyboard;
  reason: string;
  onFinish: (unlocked: boolean) => void;
  /** Overrides the poll interval (tests). */
  pollIntervalMs?: number;
}

export function UnlockDialog({ keyboard, reason, onFinish, pollIntervalMs }: Props) {
  const [progress, setProgress] = useState<UnlockProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controller] = useState(() => new AbortController());

  useEffect(() => {
    let live = true;
    runUnlock(keyboard.queue, {
      onProgress: (p) => live && setProgress(p),
      signal: controller.signal,
      pollIntervalMs,
    })
      .then((ok) => {
        if (!live) return;
        if (ok) keyboard.setUnlocked(true);
        onFinish(ok);
      })
      .catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
      controller.abort();
    };
    // Runs once per dialog; onFinish is stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targets = new Set(progress?.keys.map((k) => `${k.row},${k.col}`) ?? []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
        <h2 id="unlock-title">Unlock the keyboard</h2>
        <p>{reason} needs the keyboard to be unlocked. Only unlock it on a computer you trust.</p>
        <p>
          Press and hold the highlighted keys until the bar fills. To lock it again, replug the keyboard or
          use Lock in the header.
        </p>
        {progress && progress.keys.length > 0 && (
          <div className="board-wrap small">
            <KeyboardView
              keyboard={keyboard}
              layer={0}
              highlight={(r, c) => (targets.has(`${r},${c}`) ? "target" : null)}
              label="Keys to hold"
            />
          </div>
        )}
        <progress
          className="unlock-progress"
          max={1}
          value={progress?.fraction ?? 0}
          aria-label="Unlock progress"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            onClick={() => {
              controller.abort();
              onFinish(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
