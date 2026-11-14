// SPDX-License-Identifier: GPL-2.0-or-later
// QMK settings panel, after vial-gui's editor/qmk_settings.py: one tab per
// qmk_settings.json tab that has a setting this board supports, a check box per
// boolean field and a number box per integer field, and a Reset button that
// asks first. Deviation: changes are written straight away (vial-gui collects
// them behind Save/Undo buttons); number boxes write on Enter or when they
// lose focus, and only values within the field's min/max. Styled like the
// redesigned views: a heading, tab chips and one card of settings rows.

import { useRef, useState } from "react";
import {
  qmkSettingsExtension,
  type QmkSettingField,
  type QmkSettings,
} from "../../core/extensions/qmk-settings.ts";
import { errorMessage } from "../hooks.ts";
import { Button } from "../ui/index.ts";
import { panel, type AppExtension, type PanelProps } from "./registry.tsx";

const ROW =
  "flex min-h-11 items-center justify-between gap-6 border-t border-kumo-line py-2 first:border-t-0";

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
    <div className={ROW}>
      <label htmlFor={id} className="text-sm [overflow-wrap:anywhere]">
        {field.title}
      </label>
      <input
        id={id}
        type="checkbox"
        className="size-[18px] shrink-0 accent-accent"
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
    <div className={ROW}>
      <label htmlFor={id} className="text-sm [overflow-wrap:anywhere]">
        {field.title}
      </label>
      <span className="flex shrink-0 items-center gap-2">
        {invalid && (
          <span id={`${id}-error`} className="text-xs text-kumo-danger">
            {min}–{max}
          </span>
        )}
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
          className={
            "w-24 rounded-md border bg-kumo-control px-2 py-1 text-right font-mono text-sm " +
            (invalid ? "border-kumo-danger" : "border-kumo-line")
          }
        />
      </span>
    </div>
  );
}

function QmkSettingsPanel({ ctx, state: settings }: PanelProps<QmkSettings>) {
  const { error: onError, info: onNotice } = ctx.notify;
  const [tabName, setTabName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
    <section className="flex max-w-2xl flex-col gap-4" aria-label="QMK settings">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-xl font-semibold">QMK settings</h1>
        <p className="m-0 text-sm leading-snug text-kumo-subtle">
          Settings stored on the keyboard: tap-hold timing, Magic, Auto Shift, combos, one-shot keys and more.
          Changes are written straight away.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="QMK settings groups">
        {tabs.map((t, i) => (
          <button
            key={t.name}
            id={`qmk-settings-tab-${i}`}
            role="tab"
            aria-selected={t === tab}
            aria-controls="qmk-settings-tabpanel"
            className={
              "min-h-10 cursor-pointer rounded-lg border px-3.5 text-sm " +
              (t === tab
                ? "border-accent bg-accent-tint font-semibold"
                : "border-kumo-line hover:bg-kumo-tint")
            }
            onClick={() => setTabName(t.name)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div
        id="qmk-settings-tabpanel"
        className="flex flex-col rounded-xl border border-kumo-line bg-kumo-elevated px-5 py-2"
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
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm">Reset all settings to default values? This cannot be undone.</span>
            <Button variant="secondary-destructive" onClick={() => void reset()} disabled={busy}>
              Reset
            </Button>
            <Button onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={busy}>
            Reset to defaults…
          </Button>
        )}
      </div>
    </section>
  );
}

export const qmkSettingsUi: AppExtension = {
  id: qmkSettingsExtension.id,
  panels: [
    panel<QmkSettings>({
      id: "qmk-settings",
      modern: true,
      title: "QMK settings",
      Component: QmkSettingsPanel,
    }),
  ],
};
