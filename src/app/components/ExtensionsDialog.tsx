// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { BUILTIN_EXTENSIONS } from "../../core/extensions/index.ts";
import type { ExtensionGroup, KeyboardExtension } from "../../core/extensions/types.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { conflicting, requirementsOf } from "../../core/extensions/manifest.ts";
import { markTurnedOn } from "../extensions/registry.tsx";
import { nameList, planTurnOff, planTurnOn, type SwitchChange } from "../extensions/switches.ts";
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
  /** The extensions to list; every built-in one by default (tests pass their own). */
  extensions?: readonly KeyboardExtension<unknown>[];
}

interface Question {
  text: string;
  changes: readonly SwitchChange[];
}

/**
 * Turns built-in features on and off, in foldable groups (design board
 * "Extensions"): standard Vial features (folded at first), ViaLink extras that
 * work with standard Vial, and non-standard extensions (e.g. layer names). The choice is remembered in this
 * browser and applies to the connected keyboard right away.
 *
 * Switching one on or off asks first when it changes another extension too
 * (src/app/extensions/switches.ts): a requirement turned on with it, a running
 * conflicting extension turned off, or dependents turned off with it.
 */
export function ExtensionsDialog({
  disabled,
  onChange,
  keyboard,
  onError,
  onClose,
  extensions = BUILTIN_EXTENSIONS,
}: Props) {
  useKeyboardVersion(keyboard);
  const [checking, setChecking] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const active = new Set(keyboard?.activeExtensions.map((a) => a.extension.id) ?? []);
  const nameOf = (id: string) => extensions.find((e) => e.id === id)?.name ?? id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (question) setQuestion(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, question]);

  const apply = async (changes: readonly SwitchChange[]) => {
    setQuestion(null);
    const next = new Set(disabled);
    for (const { id, on } of changes) {
      if (on) next.delete(id);
      else next.add(id);
    }
    const turnedOn = changes.filter((c) => c.on).map((c) => c.id);
    if (turnedOn.length > 0) markTurnedOn(turnedOn);
    onChange(next);
    if (!keyboard) return;
    const exts = changes.flatMap(({ id, on }) => {
      const extension = extensions.find((e) => e.id === id);
      return extension ? [{ extension, enabled: on }] : [];
    });
    setChecking(changes[0].on ? changes[0].id : null);
    try {
      await keyboard.setExtensionsEnabled(exts);
    } catch (err) {
      onError(`${nameOf(changes[0].id)}: ${errorMessage(err)}`);
    } finally {
      setChecking(null);
    }
  };

  const toggle = async (ext: KeyboardExtension<unknown>, on: boolean) => {
    let plan;
    if (!on) plan = planTurnOff(ext, extensions, disabled);
    else {
      // Whether a conflict changes anything depends on what the keyboard supports.
      const support = new Map<string, boolean>();
      if (keyboard) {
        setChecking(ext.id);
        try {
          const turningOn = [ext, ...requirementsOf(ext.id, extensions)];
          const clashes = turningOn.filter((t) =>
            extensions.some((o) => active.has(o.id) && conflicting(t, o)),
          );
          for (const t of clashes) {
            for (const e of [t, ...requirementsOf(t.id, extensions)]) {
              if (!support.has(e.id)) support.set(e.id, await keyboard.supportsExtension(e));
            }
          }
        } catch (err) {
          onError(`${ext.name}: ${errorMessage(err)}`);
          return;
        } finally {
          setChecking(null);
        }
      }
      plan = planTurnOn(
        ext,
        extensions,
        disabled,
        (id) => active.has(id),
        (id) => support.get(id) ?? true,
      );
    }
    if (plan.question) setQuestion({ text: plan.question, changes: plan.changes });
    else await apply(plan.changes);
  };

  const status = (ext: KeyboardExtension<unknown>): string | null => {
    if (checking === ext.id) return "Checking the keyboard…";
    if (disabled.has(ext.id)) return keyboard ? "Turned off." : null;
    const off = (ext.requires ?? []).filter((id) => disabled.has(id));
    if (!keyboard) return off.length > 0 ? `Needs ${nameList(off.map(nameOf))}.` : null;
    const s = keyboard.extensionStatus(ext.id);
    switch (s.kind) {
      case "active":
        return "Active on this keyboard.";
      case "unsupported":
        return "Not supported by this keyboard.";
      case "needs":
        return `Needs ${nameList(s.ids.map(nameOf))}.`;
      case "conflict":
        return `Not running: doesn't work with ${nameOf(s.with)}, which is on.`;
      case "off":
        return null;
    }
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
            const items = extensions.filter((ext) => ext.group === group.id);
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
                    const line = status(ext);
                    return (
                      <li key={ext.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={!disabled.has(ext.id)}
                            disabled={checking !== null || question !== null}
                            onChange={(e) => void toggle(ext, e.target.checked)}
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
        {question ? (
          <div
            className="dialog-actions extension-question"
            role="alertdialog"
            aria-label="Turn extensions on or off"
          >
            <p>{question.text}</p>
            <button onClick={() => setQuestion(null)}>No</button>
            <button className="primary" autoFocus onClick={() => void apply(question.changes)}>
              Yes
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
