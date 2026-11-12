// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";

interface Props {
  disabled: Set<string>;
  onChange: (disabled: Set<string>) => void;
  keyboard: Keyboard | null;
  onError: (message: string) => void;
  onClose: () => void;
}

/**
 * Turns built-in extensions on and off. The choice is remembered in this
 * browser and applies to the connected keyboard right away.
 */
export function ExtensionsDialog({ disabled, onChange, keyboard, onError, onClose }: Props) {
  useKeyboardVersion(keyboard);
  const [checking, setChecking] = useState<string | null>(null);
  const active = new Set(keyboard?.activeExtensions.map((a) => a.extension.id) ?? []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = async (id: string, on: boolean) => {
    const next = new Set(disabled);
    if (on) next.delete(id);
    else next.add(id);
    onChange(next);
    const ext = BUILTIN_EXTENSIONS.find((e) => e.id === id);
    if (!keyboard || !ext) return;
    setChecking(on ? id : null);
    try {
      await keyboard.setExtensionEnabled(ext, on);
    } catch (err) {
      onError(`${ext.name}: ${errorMessage(err)}`);
    } finally {
      setChecking(null);
    }
  };

  const status = (id: string): string | null => {
    if (!keyboard) return null;
    if (checking === id) return "Checking the keyboard…";
    if (disabled.has(id)) return "Turned off.";
    return active.has(id) ? "Active on this keyboard." : "Not supported by this keyboard.";
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ext-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="ext-title">Extensions</h2>
          <p className="hint">Optional features. Your choices are remembered in this browser.</p>
        </div>
        <ul className="extension-list dialog-body">
          {BUILTIN_EXTENSIONS.map((ext) => {
            const line = status(ext.id);
            return (
              <li key={ext.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!disabled.has(ext.id)}
                    disabled={checking !== null}
                    onChange={(e) => void toggle(ext.id, e.target.checked)}
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
                {line && (
                  <p className={`hint extension-status${active.has(ext.id) ? " on" : ""}`} aria-live="polite">
                    {line}
                  </p>
                )}
              </li>
            );
          })}
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
