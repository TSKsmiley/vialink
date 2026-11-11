// SPDX-License-Identifier: GPL-2.0-or-later
// Save the current layout as .vil, or load one and write it to the board with
// progress, after a confirmation that names a UID mismatch and anything the
// file holds that this version does not apply yet.

import { useRef, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { applyVilRestore, parseVil, planVilRestore, saveVil, type RestorePlan } from "../../core/vil.ts";
import { downloadText, errorMessage } from "../hooks.ts";

interface Props {
  keyboard: Keyboard;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function VilControls({ keyboard, busy, setBusy, onError, onNotice }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; plan: RestorePlan } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const save = () => {
    const name = (keyboard.name || "keyboard").replace(/[^\w-]+/g, "_");
    downloadText(`${name}.vil`, saveVil(keyboard));
  };

  const onFile = async (file: File) => {
    try {
      const plan = planVilRestore(keyboard, parseVil(await file.text()));
      setPending({ name: file.name, plan });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const apply = async () => {
    if (!pending) return;
    const { plan } = pending;
    setPending(null);
    setBusy(true);
    try {
      await applyVilRestore(keyboard, plan, (done, total) => setProgress({ done, total }));
      onNotice(
        plan.ops.length === 0 ? "The board already matches this file." : `Wrote ${plan.ops.length} changes.`,
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="vil-controls">
      <button onClick={save} disabled={busy}>
        Save .vil
      </button>
      <button onClick={() => input.current?.click()} disabled={busy}>
        Load .vil
      </button>
      <input
        ref={input}
        type="file"
        accept=".vil,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
      {progress && (
        <span className="progress">
          <progress max={progress.total || 1} value={progress.done} /> {progress.done}/{progress.total}
        </span>
      )}

      {pending && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="vil-title">
            <h2 id="vil-title">Load {pending.name}?</h2>
            {pending.plan.uidMismatch && (
              <p className="warning">
                This file was saved from a different keyboard (UID mismatch). Loading it may assign keys that
                make no sense on this board.
              </p>
            )}
            <p>
              {pending.plan.ops.length === 0
                ? "The board already matches this file's keymap."
                : `${pending.plan.ops.length} keys, encoders or layout options will be written to the board.`}
            </p>
            {pending.plan.skippedFeatures.length > 0 && (
              <p>Not applied by this version: {pending.plan.skippedFeatures.join(", ")}.</p>
            )}
            {pending.plan.unknownKeycodes.length > 0 && (
              <p>Unrecognised keycodes, skipped: {pending.plan.unknownKeycodes.slice(0, 8).join(", ")}</p>
            )}
            {pending.plan.ignoredEntries > 0 && (
              <p>{pending.plan.ignoredEntries} entries refer to keys or layers this board does not have.</p>
            )}
            <div className="dialog-actions">
              <button onClick={() => setPending(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => void apply()}
                disabled={pending.plan.ops.length === 0}
              >
                Write to keyboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
