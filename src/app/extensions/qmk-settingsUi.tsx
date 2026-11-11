// SPDX-License-Identifier: GPL-2.0-or-later
// QMK settings panel, after vial-gui's editor/qmk_settings.py: one tab per
// qmk_settings.json tab that has a setting this board supports, a check box per
// boolean field and a number box per integer field, and a Reset button that
// asks first. Deviation: changes are written straight away (vial-gui collects
// them behind Save/Undo buttons); number boxes write on Enter or when they
// lose focus, and only values within the field's min/max.

import { useRef, useState } from "react";
import {
  qmkSettingsExtension,
  type QmkSettingField,
  type QmkSettings,
} from "../../core/extensions/qmk-settings.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import type { AppExtension, PanelProps } from "./registry.tsx";
import "./qmk-settings.css";

interface FieldProps {
  settings: QmkSettings;
  field: QmkSettingField;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<boolean>;
}

const fieldId = (field: QmkSettingField) => `qmk-setting-${field.qsid}-${field.bit ?? 0}`;

function BooleanField({ settings, field, busy, run }: FieldProps) {
  const id = fieldId(field);
  return (
    <div className="qmk-setting">
      <label htmlFor={id}>{field.title}</label>
      <input
        id={id}
        type="checkbox"
        checked={settings.isChecked(field)}
        disabled={busy}
        onChange={(e) => void run(() => settings.setBit(field.qsid, field.bit ?? 0, e.target.checked))}
      />
    </div>
  );
}

function IntegerField({ settings, field, busy, run }: FieldProps) {
  const value = settings.get(field.qsid) ?? 0;
  const [draft, setDraft] = useState(String(value));
  // Enter then blur (the box is disabled while writing) must not send twice.
  const committing = useRef(false);
  const min = field.min ?? 0;
  const max = field.max ?? 0xffff;
  const id = fieldId(field);
  const parsed = /^\s*\d+\s*$/.test(draft) ? Number(draft) : NaN;
  const invalid = !(Number.isInteger(parsed) && parsed >= min && parsed <= max);

  const commit = async () => {
    if (invalid || parsed === value || committing.current) return;
    committing.current = true;
    const ok = await run(() => settings.set(field.qsid, parsed));
    committing.current = false;
    if (!ok) setDraft(String(value));
  };

  return (
    <div className="qmk-setting">
      <label htmlFor={id}>{field.title}</label>
      <span className="qmk-setting-value">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={busy}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setDraft(String(value));
          }}
        />
        {invalid && (
          <span id={`${id}-error`} className="error">
            {min}–{max}
          </span>
        )}
      </span>
    </div>
  );
}

function QmkSettingsPanel({ keyboard, onError, onNotice }: PanelProps) {
  useKeyboardVersion(keyboard);
  const settings = keyboard.extension(qmkSettingsExtension);
  const [tabName, setTabName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!settings) return <p className="hint">This keyboard has no QMK settings.</p>;

  const tabs = settings.tabs;
  const tab = tabs.find((t) => t.name === tabName) ?? tabs[0];
  const tabIndex = tabs.indexOf(tab);

  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setConfirming(false);
    if (await run(() => settings.reset())) onNotice("QMK settings reset to their default values.");
  };

  return (
    <section className="qmk-settings" aria-label="QMK settings">
      <div className="tabs" role="tablist" aria-label="QMK settings groups">
        {tabs.map((t, i) => (
          <button
            key={t.name}
            id={`qmk-settings-tab-${i}`}
            role="tab"
            aria-selected={t === tab}
            aria-controls="qmk-settings-tabpanel"
            className={t === tab ? "active" : ""}
            onClick={() => setTabName(t.name)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div
        id="qmk-settings-tabpanel"
        className="qmk-settings-fields"
        role="tabpanel"
        aria-labelledby={`qmk-settings-tab-${tabIndex}`}
      >
        {tab.fields.map((field) =>
          field.type === "boolean" ? (
            <BooleanField key={fieldId(field)} settings={settings} field={field} busy={busy} run={run} />
          ) : (
            // Re-mount when the stored value changes elsewhere (reset, .vil load) to drop the draft.
            <IntegerField
              key={`${fieldId(field)}=${settings.get(field.qsid)}`}
              settings={settings}
              field={field}
              busy={busy}
              run={run}
            />
          ),
        )}
      </div>
      <div className="qmk-settings-actions">
        {confirming ? (
          <>
            <span>Reset all settings to default values?</span>
            <button className="primary" onClick={() => void reset()} disabled={busy}>
              Reset
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={busy}>
            Reset to defaults…
          </button>
        )}
      </div>
    </section>
  );
}

export const qmkSettingsUi: AppExtension = {
  id: qmkSettingsExtension.id,
  panels: [{ id: "qmk-settings", title: "QMK settings", Component: QmkSettingsPanel }],
};
