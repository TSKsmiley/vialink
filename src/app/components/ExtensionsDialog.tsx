// SPDX-License-Identifier: GPL-2.0-or-later
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { Keyboard } from "../../core/keyboard.ts";

interface Props {
  disabled: Set<string>;
  onChange: (disabled: Set<string>) => void;
  keyboard: Keyboard | null;
  onClose: () => void;
}

/** Turns built-in extensions on and off. Changes apply on the next connect. */
export function ExtensionsDialog({ disabled, onChange, keyboard, onClose }: Props) {
  const active = new Set(keyboard?.activeExtensions.map((a) => a.extension.id) ?? []);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ext-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ext-title">Extensions</h2>
        <p className="hint">Optional features. Changes apply the next time you connect a keyboard.</p>
        <ul className="extension-list">
          {BUILTIN_EXTENSIONS.map((ext) => (
            <li key={ext.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!disabled.has(ext.id)}
                  onChange={(e) => {
                    const next = new Set(disabled);
                    if (e.target.checked) next.delete(ext.id);
                    else next.add(ext.id);
                    onChange(next);
                  }}
                />
                <strong>{ext.name}</strong>
              </label>
              <p className="hint">{ext.description}</p>
              {ext.firmware && (
                <p className="hint">
                  Firmware:{" "}
                  <a href={ext.firmware.url} target="_blank" rel="noreferrer">
                    {ext.firmware.label}
                  </a>
                </p>
              )}
              {keyboard && (
                <p className="hint">
                  {active.has(ext.id)
                    ? "Active on this keyboard."
                    : disabled.has(ext.id)
                      ? "Turned off."
                      : "Not supported by this keyboard."}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
