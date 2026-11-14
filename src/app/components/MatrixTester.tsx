// SPDX-License-Identifier: GPL-2.0-or-later
// Matrix tester, after vial-gui's editor/matrix_test.py: while the board is
// unlocked, poll the switch matrix and light up keys that are down now and
// keys that have been pressed at least once. Like vial-gui (grabKeyboard while
// the tab is shown), the page ignores key presses while testing, so Tab, Space,
// arrows or Ctrl+Z don't move focus, scroll or undo.
// Deviations: capturing can be switched off, and holding Esc switches it off,
// so someone using only the keyboard can leave the tester. The browser and the
// system keep their own shortcuts (Ctrl+W, Ctrl+T, Alt+Tab, the Super key).

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KeyboardView } from "./KeyboardView.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  /** Delay between polls; vial-gui uses a 20 ms timer. */
  intervalMs?: number;
  /** How long Esc must be held to stop capturing keys. */
  releaseHoldMs?: number;
}

const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

export function MatrixTester({ keyboard, onError, intervalMs = 30, releaseHoldMs = 1500 }: Props) {
  useKeyboardVersion(keyboard);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [capturing, setCapturing] = useState(true);
  const unlocked = keyboard.unlocked === true;
  const capture = unlocked && capturing && keyboard.matrixTesterSupported;

  useEffect(() => {
    if (!capture) return;
    let escHeld: number | undefined;
    // Window, capture phase: runs before every other key handler on the page.
    const swallow = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") return;
      if (e.type === "keydown" && !e.repeat) {
        window.clearTimeout(escHeld);
        escHeld = window.setTimeout(() => setCapturing(false), releaseHoldMs);
      } else if (e.type === "keyup") {
        window.clearTimeout(escHeld);
      }
    };
    for (const type of KEY_EVENTS) window.addEventListener(type, swallow, true);
    return () => {
      window.clearTimeout(escHeld);
      for (const type of KEY_EVENTS) window.removeEventListener(type, swallow, true);
    };
  }, [capture, releaseHoldMs]);

  useEffect(() => {
    if (!keyboard.matrixTesterSupported) return;
    if (keyboard.unlocked === null) void keyboard.isUnlocked().catch(() => undefined);
  }, [keyboard]);

  useEffect(() => {
    if (!unlocked || !keyboard.matrixTesterSupported) return;
    // On the keyboard's scheduler: no pile-up, pauses while the tab is hidden or
    // an operation writes, and its polls go behind the user's own requests.
    const task = keyboard.scheduler.every(
      intervalMs,
      async () => {
        try {
          const matrix = await keyboard.pollMatrix({ priority: "low" });
          if (matrix === null) {
            task.stop();
            keyboard.setUnlocked(false); // locked elsewhere (replug, Lock)
            return;
          }
          const now = new Set<string>();
          matrix.forEach((row, r) => row.forEach((on, c) => on && now.add(`${r},${c}`)));
          setPressed(now);
          if (now.size > 0) setSeen((prev) => (hasAll(prev, now) ? prev : new Set([...prev, ...now])));
        } catch (err) {
          task.stop();
          onError(errorMessage(err));
        }
      },
      { name: "matrix tester", kind: "live", owner: "app" },
    );
    return () => task.stop();
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
          <div>
            <p className="hint">
              Press keys to test them. Tested: {[...seen].filter((k) => hasPosition(keyboard, k)).length}/
              {total}
            </p>
            <p className="hint" aria-live="polite">
              {capturing
                ? "The page ignores your keys while you test. Hold Esc to let them through."
                : "Keys also reach the page."}
            </p>
          </div>
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
          {unlocked && (
            <label className="capture-keys">
              <input type="checkbox" checked={capturing} onChange={(e) => setCapturing(e.target.checked)} />
              Capture keys
            </label>
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
