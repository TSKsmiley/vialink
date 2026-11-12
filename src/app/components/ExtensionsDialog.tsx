// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { ExtensionGroup } from "../../core/extensions/types.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";

const GROUPS: { id: ExtensionGroup; title: string; hint: string; open: boolean }[] = [
  {
    id: "standard",
    title: "Standard Vial",
    hint: "Part of Vial itself. Shown when the keyboard's firmware was built with them.",
    open: false,
  },
  {
    id: "compatible",
    title: "Standard Vial compatible",
    hint: "Work with standard Vial firmware, but are ViaLink extras that desktop Vial does not show.",
    open: true,
  },
  {
    id: "nonstandard",
    title: "Non-standard Vial",
    hint: "Need firmware beyond standard Vial. Desktop Vial does not show these.",
    open: true,
  },
];

interface Props {
  disabled: Set<string>;
  onChange: (disabled: Set<string>) => void;
  keyboard: Keyboard | null;
  onError: (message: string) => void;
  onClose: () => void;
}

/**
 * Turns built-in features on and off, in foldable groups (design board
 * "Extensions"): standard Vial features (folded at first), ViaLink extras that
 * work with standard Vial, and non-standard extensions (e.g. layer names). The choice is remembered in this
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
          <p className="hint">
            Turn features off to hide them. Click a section heading to fold it. Your choices are remembered in
            this browser; nothing is written to the keyboard, so this is not part of undo.
          </p>
        </div>
        <div className="dialog-body">
          {GROUPS.map((group) => {
            const items = BUILTIN_EXTENSIONS.filter((ext) => (ext.group ?? "nonstandard") === group.id);
            if (items.length === 0) return null;
            const on = items.filter((ext) => !disabled.has(ext.id)).length;
            return (
              <details
                key={group.id}
                open={group.open}
                className="extension-group"
                aria-labelledby={`ext-group-${group.id}`}
              >
                <summary>
                  <svg className="chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <h3 id={`ext-group-${group.id}`}>{group.title}</h3>
                  <span className="hint">
                    {on} of {items.length} on
                  </span>
                </summary>
                <p className="hint">{group.hint}</p>
                <ul className="extension-list">
                  {items.map((ext) => {
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
                          <p
                            className={`hint extension-status${active.has(ext.id) ? " on" : ""}`}
                            aria-live="polite"
                          >
                            {line}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
