// SPDX-License-Identifier: GPL-2.0-or-later
// Matrix tester, after vial-gui's editor/matrix_test.py: while the board is
// unlocked, poll the switch matrix and light up keys that are down now and
// keys that have been pressed at least once.

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KeyboardView } from "./KeyboardView.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  /** Delay between polls; vial-gui uses a 20 ms timer. */
  intervalMs?: number;
}

export function MatrixTester({ keyboard, onError, intervalMs = 30 }: Props) {
  useKeyboardVersion(keyboard);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const unlocked = keyboard.unlocked === true;

  useEffect(() => {
    if (!keyboard.matrixTesterSupported) return;
    if (keyboard.unlocked === null) void keyboard.isUnlocked().catch(() => undefined);
  }, [keyboard]);

  useEffect(() => {
    if (!unlocked || !keyboard.matrixTesterSupported) return;
    let live = true;
    const loop = async () => {
      while (live) {
        try {
          const matrix = await keyboard.pollMatrix();
          if (!live) return;
          if (matrix === null) {
            keyboard.setUnlocked(false); // locked elsewhere (replug, Lock)
            return;
          }
          const now = new Set<string>();
          matrix.forEach((row, r) => row.forEach((on, c) => on && now.add(`${r},${c}`)));
          setPressed(now);
          if (now.size > 0) setSeen((prev) => (hasAll(prev, now) ? prev : new Set([...prev, ...now])));
        } catch (err) {
          if (live) onError(errorMessage(err));
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [keyboard, unlocked, intervalMs, onError]);

  if (!keyboard.matrixTesterSupported) {
    return (
      <p className="hint">
        The matrix tester needs Vial protocol 3 or later and a matrix small enough for one HID report; this
        keyboard has neither.
      </p>
    );
  }

  const total = keyboard.matrixPositions.length;
  return (
    <section className="matrix-tester" aria-label="Matrix tester">
      <div className="toolbar">
        {unlocked ? (
          <p className="hint">
            Press keys to test them. Tested: {[...seen].filter((k) => hasPosition(keyboard, k)).length}/
            {total}
          </p>
        ) : (
          <p className="hint">The keyboard must be unlocked to read its switch matrix.</p>
        )}
        <div className="vil-controls">
          {!unlocked && (
            <button
              className="primary"
              onClick={() =>
                void keyboard.ensureUnlocked("The matrix tester").catch((e) => onError(errorMessage(e)))
              }
            >
              Unlock
            </button>
          )}
          <button onClick={() => setSeen(new Set())} disabled={seen.size === 0}>
            Reset
          </button>
        </div>
      </div>
      <div className="board-wrap">
        <KeyboardView
          keyboard={keyboard}
          layer={0}
          label="Matrix tester"
          highlight={(r, c) => {
            const id = `${r},${c}`;
            if (pressed.has(id)) return "pressed";
            if (seen.has(id)) return "seen";
            return null;
          }}
        />
      </div>
    </section>
  );
}

function hasAll(set: Set<string>, items: Set<string>): boolean {
  for (const i of items) if (!set.has(i)) return false;
  return true;
}

function hasPosition(keyboard: Keyboard, id: string): boolean {
  return keyboard.matrixPositions.some((p) => `${p.row},${p.col}` === id);
}
