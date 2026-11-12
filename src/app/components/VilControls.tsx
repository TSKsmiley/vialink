// SPDX-License-Identifier: GPL-2.0-or-later
// Save the current layout as a .vil file or in the browser, and load either
// back onto the board with progress, after a confirmation that names a UID
// mismatch and anything the layout holds that this version does not apply.
// Shown as the "Layouts" menu in the top bar.

import { useRef, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { applyVilRestore, parseVil, planVilRestore, saveVil, type RestorePlan } from "../../core/vil.ts";
import { downloadText, errorMessage, fileNameFor } from "../hooks.ts";
import { defaultLayoutName, layoutStore, newLayoutId, requestPersistence } from "../storage/savedLayouts.ts";
import { Button, DropdownMenu } from "../ui/index.ts";
import { CaretDownIcon } from "@phosphor-icons/react";
import { SavedLayoutsDialog } from "./SavedLayoutsDialog.tsx";

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
  const [saveName, setSaveName] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const download = () => downloadText(fileNameFor(keyboard.name), saveVil(keyboard));

  /** Shared by files and browser saves: parse, plan, and ask before writing. */
  const loadText = (text: string, source: string) => {
    try {
      setPending({ name: source, plan: planVilRestore(keyboard, parseVil(text)) });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const saveToBrowser = async (name: string) => {
    try {
      await layoutStore().put({
        id: newLayoutId(),
        name: name.trim() || defaultLayoutName(keyboard.name),
        uid: keyboard.uid.toString(),
        keyboardName: keyboard.name,
        savedAt: new Date().toISOString(),
        vil: saveVil(keyboard),
      });
      const persistent = await requestPersistence();
      onNotice(
        persistent
          ? `Saved “${name.trim() || "layout"}” in this browser.`
          : `Saved “${name.trim() || "layout"}” in this browser. The browser may clear it if space runs low; download a .vil to be safe.`,
      );
      setSaveName(null);
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
      await applyVilRestore(
        keyboard,
        plan,
        (done, total) => setProgress({ done, total }),
        `Load ${pending.name}`,
      );
      onNotice(
        plan.ops.length === 0
          ? "The board already matches this layout."
          : `Wrote ${plan.ops.length} changes.`,
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const extensionSteps = pending?.plan.ops.filter((op) => op.kind === "extension") ?? [];
  const keymapWrites = (pending?.plan.ops.length ?? 0) - extensionSteps.length;

  return (
    <div className="vil-controls">
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <Button disabled={busy}>
              Layouts <CaretDownIcon aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={() => setShowSaved(true)}>Saved layouts…</DropdownMenu.Item>
          <DropdownMenu.Item onClick={() => setSaveName(defaultLayoutName(keyboard.name))}>
            Save in browser…
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onClick={download}>Save .vil file</DropdownMenu.Item>
          <DropdownMenu.Item onClick={() => input.current?.click()}>Load .vil file…</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        accept=".vil,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void file.text().then(
              (text) => loadText(text, file.name),
              (err) => onError(errorMessage(err)),
            );
        }}
      />
      {progress && (
        <span className="progress">
          <progress max={progress.total || 1} value={progress.done} /> {progress.done}/{progress.total}
        </span>
      )}

      {saveName !== null && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-title"
            onSubmit={(e) => {
              e.preventDefault();
              void saveToBrowser(saveName);
            }}
          >
            <h2 id="save-title">Save in this browser</h2>
            <p className="hint">
              Keeps a copy of the current layout in this browser, for this site only. Open it again from Saved
              layouts.
            </p>
            <label className="field">
              Name
              <input value={saveName} autoFocus onChange={(e) => setSaveName(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setSaveName(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {showSaved && (
        <SavedLayoutsDialog
          keyboard={keyboard}
          onLoad={(layout) => {
            setShowSaved(false);
            loadText(layout.vil, layout.name);
          }}
          onError={onError}
          onClose={() => setShowSaved(false)}
        />
      )}

      {pending && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="vil-title">
            <h2 id="vil-title">Load {pending.name}?</h2>
            {pending.plan.uidMismatch && (
              <p className="warning">
                This layout was saved from a different keyboard (UID mismatch). Loading it may assign keys
                that make no sense on this board.
              </p>
            )}
            <p>
              {pending.plan.ops.length === 0
                ? "The board already matches this layout."
                : `${keymapWrites} keys, encoders or layout options will be written to the board.`}
            </p>
            {extensionSteps.length > 0 && (
              <ul>
                {extensionSteps.map((op, i) => (
                  <li key={i}>{op.kind === "extension" ? op.description : null}</li>
                ))}
              </ul>
            )}
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
