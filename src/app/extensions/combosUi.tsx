// SPDX-License-Identifier: GPL-2.0-or-later
// Combos view (design board 3), following vial-gui's editor/combos.py: every
// combo has four trigger keys ("Key 1".."Key 4") and an output key.
//
// Deviations from vial-gui:
// - A list of the combos that are set up and one in detail (vial-gui: a tab
//   per combo); "New combo" opens the first unused one.
// - Trigger keys are picked by clicking keys on a small copy of the base
//   layer (their keycodes, since combos match keycodes, not positions), or by
//   typing a key; the output key is found by name, shortcut or expression.
// - Triggers are kept packed at the front, so none is ignored after an empty
//   slot (the firmware stops at the first KC_NO).
// - Every change is written at once and is one undo step.

import { useState } from "react";
import { combosExtension, describeCombo, type Combos } from "../../core/extensions/combos.ts";
import { qmkSettingsExtension } from "../../core/extensions/qmk-settings.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { COMBO_INPUTS, type ComboEntry } from "../../core/protocol/combos.ts";
import { KeyboardView } from "../components/KeyboardView.tsx";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KeySearch, keyText } from "../keymap/KeySearch.tsx";
import { Button } from "../ui/index.ts";
import { DetailCard, EntryList, FeatureLayout } from "./featureLayout.tsx";
import type { AppExtension, PanelProps } from "./registry.tsx";

/** QMK settings qsid of "Time out period for combos" (qmk_settings.json, Combo tab). */
const COMBO_TERM_QSID = 2;

const isSet = (e: Readonly<ComboEntry>) => e.some((c) => c !== 0);
const triggersOf = (e: Readonly<ComboEntry>) => e.slice(0, COMBO_INPUTS).filter((c) => c !== 0);

function Chips({ keyboard, entry }: { keyboard: Keyboard; entry: Readonly<ComboEntry> }) {
  const t = keyboard.keycodes;
  const triggers = triggersOf(entry);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {triggers.length === 0 ? (
        <span className="text-kumo-subtle">no keys</span>
      ) : (
        triggers.map((c, i) => (
          <span key={i} className="rounded border border-kumo-line px-1.5 py-0.5 text-xs">
            {keyText(t, c)}
          </span>
        ))
      )}
      <span aria-hidden="true">→</span>
      <strong className="text-sm">{entry[COMBO_INPUTS] ? keyText(t, entry[COMBO_INPUTS]) : "nothing"}</strong>
    </span>
  );
}

export function CombosPanel({ keyboard, onError, onOpen }: PanelProps) {
  useKeyboardVersion(keyboard);
  const combos = keyboard.extension(combosExtension);
  const used = combos ? combos.entries.flatMap((e, i) => (isSet(e) ? [i] : [])) : [];
  const [selected, setSelected] = useState<number>(used[0] ?? 0);
  if (!combos) return null;

  const shown = used.includes(selected) ? used : [...used, selected].sort((a, b) => a - b);
  const free = combos.entries.findIndex((e, i) => !isSet(e) && i !== selected);

  return (
    <FeatureLayout
      list={
        <EntryList
          title="Combos"
          used={`${used.length} of ${combos.count} used`}
          description="Press keys together to send another key."
          items={shown.map((i) => ({
            id: i,
            title: `Combo ${i + 1}`,
            meta: "",
            summary: <Chips keyboard={keyboard} entry={combos.get(i)} />,
          }))}
          selected={selected}
          onSelect={setSelected}
          newLabel="New combo"
          onNew={free === -1 ? undefined : () => setSelected(free)}
        />
      }
      detail={
        <ComboDetail
          key={selected}
          keyboard={keyboard}
          combos={combos}
          idx={selected}
          onError={onError}
          onOpen={onOpen}
        />
      }
    />
  );
}

function ComboDetail({
  keyboard,
  combos,
  idx,
  onError,
  onOpen,
}: {
  keyboard: Keyboard;
  combos: Combos;
  idx: number;
  onError: (m: string) => void;
  onOpen?: (view: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const entry = combos.get(idx);
  const table = keyboard.keycodes;
  const triggers = triggersOf(entry);
  const output = entry[COMBO_INPUTS];
  const settings = keyboard.extension(qmkSettingsExtension);
  const term = settings?.get(COMBO_TERM_QSID);

  const write = async (nextTriggers: number[], nextOutput: number) => {
    const next = [...nextTriggers, 0, 0, 0, 0].slice(0, COMBO_INPUTS) as number[];
    setBusy(true);
    try {
      await combos.set(idx, [...next, nextOutput] as ComboEntry);
    } catch (err) {
      onError(`Combo ${idx + 1}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (code: number) => {
    if (code === 0 || busy) return;
    if (triggers.includes(code))
      void write(
        triggers.filter((c) => c !== code),
        output,
      );
    else if (triggers.length < COMBO_INPUTS) void write([...triggers, code], output);
    else onError(`Combo ${idx + 1}: a combo has at most ${COMBO_INPUTS} keys. Remove one first.`);
  };

  const title =
    triggers.length || output
      ? `${triggers.map((c) => keyText(table, c)).join(" + ") || "No keys"} sends ${output ? keyText(table, output) : "nothing"}`
      : `Combo ${idx + 1}`;

  return (
    <DetailCard label={`Combo ${idx + 1}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <div className="flex-1" />
        <Button
          variant="secondary-destructive"
          disabled={busy || !isSet(entry)}
          onClick={() => void write([], 0)}
        >
          Delete combo
        </Button>
      </div>
      <p className="m-0 text-xs text-kumo-subtle">{describeCombo(table, entry)}</p>

      <div className="flex flex-col gap-2">
        <strong>1. Keys to press together</strong>
        <span className="text-sm text-kumo-subtle">
          Click keys on your keyboard below to add or remove them. Up to {COMBO_INPUTS}.
        </span>
        <div className="board-wrap small rounded-lg border border-kumo-line bg-kumo-base p-2">
          <KeyboardView
            keyboard={keyboard}
            layer={0}
            label="Base layer: click keys to add or remove them"
            isSelected={(s) => s.kind === "key" && triggers.includes(keyboard.getKey(0, s.row, s.col) ?? 0)}
            onSelect={(s) => {
              if (s?.kind === "key") toggle(keyboard.getKey(0, s.row, s.col) ?? 0);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {triggers.map((c) => (
            <button
              key={c}
              type="button"
              disabled={busy}
              aria-label={`Remove ${table.serialize(c)}`}
              onClick={() => toggle(c)}
              className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-accent bg-accent-tint px-2.5 text-sm"
            >
              {keyText(table, c)} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        {triggers.length < COMBO_INPUTS && (
          <KeySearch
            table={table}
            label="Or type a key to add"
            disabled={busy}
            placeholder="A key that is not on your base layer…"
            onPick={toggle}
          />
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-kumo-line pt-4">
        <strong>2. Key it sends</strong>
        <p className="m-0 text-sm">
          Sends: <strong>{output ? keyText(table, output) : "nothing yet"}</strong>
          {output ? (
            <code className="ml-2 font-mono text-xs text-kumo-subtle">{table.serialize(output)}</code>
          ) : null}
        </p>
        <KeySearch
          table={table}
          label="Output key"
          disabled={busy}
          onPick={(code) => void write(triggers, code)}
        />
        {term !== undefined && (
          <span className="text-sm text-kumo-subtle">
            Combo term: {term} ms
            {onOpen && (
              <>
                {" · "}
                <button
                  type="button"
                  className="cursor-pointer text-accent-link underline"
                  onClick={() => onOpen("qmk-settings")}
                >
                  Change in QMK settings
                </button>
              </>
            )}
          </span>
        )}
      </div>

      <p
        role="note"
        className="m-0 rounded-lg border border-dashed border-kumo-line px-3 py-2 text-sm text-kumo-subtle"
      >
        Combos match keycodes, not positions: this one also fires on any other key that sends the same keys.
      </p>
    </DetailCard>
  );
}

export const combosUi: AppExtension = {
  id: combosExtension.id,
  panels: [
    {
      id: "combos",
      modern: true,
      title: "Combos",
      Component: CombosPanel,
      count: (kb) => kb.extension(combosExtension)?.entries.filter(isSet).length ?? null,
    },
  ],
};
