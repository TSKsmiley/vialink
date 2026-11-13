// SPDX-License-Identifier: GPL-2.0-or-later
// The key inspector of the keymap (design board 1): what the selected key
// does, in words, and ways to change it by kind: a plain key, a layer key
// ("When held" / "When tapped"), a key with modifiers, a tap dance, a macro,
// or anything from the full keycode list. Below that, "Replace with any key"
// searches every keycode. Replaces the picker grid under the keyboard.
//
// Keycodes are the same values vial-gui's picker offers; only the way of
// choosing them differs. Key + mods builds QMK's QK_MODS range directly
// (bits 8-11 Ctrl/Shift/Alt/GUI, bit 12 right-hand), which is the same in
// the v5 and v6 keycode tables.

import { keyInspectorTabs } from "../extensions/registry.tsx";
import { useMemo, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import type { KeycodeTable } from "../../core/keycodes/table.ts";
import { KC_NO, KC_TRNS, layerKeyOf, type LayerKey } from "../../core/layerInfo.ts";
import type { Selection } from "../components/KeyboardView.tsx";
import { KeycodePicker, type PickerInfo } from "../components/KeycodePicker.tsx";
import { LayerKeyBuilder } from "../components/LayerKeyBuilder.tsx";
import { TapDancePicker } from "../components/TapDancePicker.tsx";
import { KeySearch, keyText } from "./KeySearch.tsx";

export type KeyKind = "key" | "layer" | "mods" | "tapdance" | "macro" | "all";

const KINDS: { id: KeyKind; label: string }[] = [
  { id: "key", label: "Key" },
  { id: "layer", label: "Layer" },
  { id: "mods", label: "Key + mods" },
  { id: "tapdance", label: "Tap dance" },
  { id: "macro", label: "Macro" },
  { id: "all", label: "All keys" },
];

const MODS = [
  { bit: 0x1, name: "Ctrl" },
  { bit: 0x2, name: "Shift" },
  { bit: 0x4, name: "Alt" },
  { bit: 0x8, name: "GUI" },
] as const;
const RIGHT = 0x10;

/** QK_MODS: a basic key with modifiers, 0x0100-0x1FFF. */
const isModsKey = (code: number) => code >= 0x0100 && code <= 0x1fff;

export function kindOf(table: KeycodeTable, layers: number, code: number | null): KeyKind {
  if (code === null) return "key";
  if (layerKeyOf(table, layers, code)) return "layer";
  if (isModsKey(code)) return "mods";
  const id = table.serialize(code);
  if (/^TD\(\d+\)$/.test(id)) return "tapdance";
  if (/^M\d+$/.test(id)) return "macro";
  if (table.isBasic(code)) return "key";
  return "all";
}

/** What a keycode does, in words: "Space, or Nav while held", "Ctrl + C". */
export function describeKey(
  table: KeycodeTable,
  layers: number,
  code: number,
  layerName: (l: number) => string,
): string {
  if (code === KC_NO) return "Nothing: the key does nothing";
  if (code === KC_TRNS) return "Transparent: uses the key from the layer below";
  const lk = layerKeyOf(table, layers, code);
  if (lk) return describeLayerKey(table, lk, layerName);
  if (isModsKey(code)) {
    const mods = (code >> 8) & 0x1f;
    const side = mods & RIGHT ? "Right " : "";
    const names = MODS.filter((m) => mods & m.bit).map((m) => side + m.name);
    return [...names, keyText(table, code & 0xff)].join(" + ");
  }
  const l = table.label(code);
  const tip = l.tooltip?.split(": ").slice(1).join(": ");
  return tip || keyText(table, code);
}

function describeLayerKey(table: KeycodeTable, lk: LayerKey, layerName: (l: number) => string): string {
  const name = layerName(lk.layer);
  switch (lk.action) {
    case "LT":
      return lk.tap ? `${keyText(table, lk.tap)}, or ${name} while held` : `${name} while held`;
    case "MO":
      return `${name} while held`;
    case "TG":
      return `Turns ${name} on or off`;
    case "TO":
      return `Switches to ${name}`;
    case "TT":
      return `${name} while held; tap a few times to toggle`;
    case "OSL":
      return `${name} for the next key press`;
    case "DF":
      return `Makes ${name} the default layer`;
    case "PDF":
      return `Makes ${name} the default layer, saved`;
  }
}

export interface KeyInspectorProps {
  keyboard: Keyboard;
  layer: number;
  /** Selected keys or encoder directions; empty when nothing is selected. */
  targets: readonly NonNullable<Selection>[];
  /** Keycode of the selection, or null when nothing is selected or the keys differ. */
  current: number | null;
  /**
   * Assigns a keycode to every target. `fillInner`: a basic keycode picked for
   * a masked key fills its inner key, as vial-gui's picker does.
   */
  onPick: (code: number, opts?: { fillInner?: boolean }) => void;
  busy: boolean;
  info: PickerInfo;
  layerName: (l: number) => string;
  recent: readonly number[];
}

export function KeyInspector({
  keyboard,
  layer,
  targets,
  current,
  onPick,
  busy,
  info,
  layerName,
  recent,
}: KeyInspectorProps) {
  const table = keyboard.keycodes;
  const groups = useMemo(() => table.groups(), [table]);
  const group = (id: string) => groups.find((g) => g.id === id)?.keycodes ?? [];
  const detected = kindOf(table, keyboard.layers, current);
  const [chosen, setChosen] = useState<KeyKind | null>(null);
  // A newly selected key opens on its own kind.
  const [seen, setSeen] = useState(targets);
  if (seen !== targets) {
    setSeen(targets);
    setChosen(null);
  }
  const kind = chosen ?? detected;
  // Extensions' tabs (keyInspector.tab slot) after ViaLink's own.
  const extTabs = keyInspectorTabs(keyboard);
  const [extTabId, setExtTabId] = useState<string | null>(null);
  const extTab = extTabs.find((t) => t.id === extTabId) ?? null;
  const disabled = targets.length === 0 || busy;
  const kinds = KINDS.filter(
    (k) =>
      (k.id !== "tapdance" || group("tapdance").length > 0) &&
      (k.id !== "macro" || group("macro").length > 0),
  );

  const where = targets.length === 0 ? null : targetName(targets, layerName(layer));

  return (
    <aside
      aria-label="Selected key"
      data-anchor="keymap.keyInspector"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-kumo-line bg-kumo-elevated p-5"
    >
      {where === null ? (
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[15px] font-semibold">No key selected</h2>
          <p className="m-0 text-sm text-kumo-subtle">
            Click a key on the keyboard to change it. Shift-click to select several.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-kumo-subtle">{where}</span>
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="grid size-16 shrink-0 place-items-center rounded-lg border-2 border-accent bg-accent-tint p-1 text-center text-[13px] leading-tight whitespace-pre-line"
            >
              {current === null ? "…" : capText(table, current)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <strong className="text-[15px]">
                {current === null
                  ? "Keys with different keycodes"
                  : describeKey(table, keyboard.layers, current, layerName)}
              </strong>
              {current !== null && (
                <code className="font-mono text-xs text-kumo-subtle">{table.serialize(current)}</code>
              )}
            </div>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Key type" className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k.id}
            role="tab"
            aria-selected={!extTab && kind === k.id}
            onClick={() => {
              setChosen(k.id);
              setExtTabId(null);
            }}
            className={
              "min-h-8 cursor-pointer rounded-lg border px-2.5 py-1 text-sm " +
              (!extTab && kind === k.id
                ? "border-accent bg-accent-tint font-semibold"
                : "border-kumo-line hover:bg-kumo-tint")
            }
          >
            {k.label}
          </button>
        ))}
        {extTabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={extTab?.id === t.id}
            onClick={() => setExtTabId(t.id)}
            className={
              "min-h-8 cursor-pointer rounded-lg border px-2.5 py-1 text-sm " +
              (extTab?.id === t.id
                ? "border-accent bg-accent-tint font-semibold"
                : "border-kumo-line hover:bg-kumo-tint")
            }
          >
            {t.title}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={extTab ? extTab.title : KINDS.find((k) => k.id === kind)?.label}
        className="flex flex-col gap-4"
      >
        {extTab ? (
          extTab.render({
            layer,
            keys: targets.flatMap((t) => (t.kind === "key" ? [{ row: t.row, col: t.col }] : [])),
            current,
          })
        ) : (
          <>
            {kind === "key" && (
              <KeyGrid
                table={table}
                keycodes={[...group("basic"), ...group("iso")]}
                current={current}
                disabled={disabled}
                onPick={(c) => onPick(c)}
              />
            )}
            {kind === "layer" && (
              <LayerPanel
                keyboard={keyboard}
                current={current}
                disabled={disabled}
                layerName={layerName}
                info={info}
                onPick={onPick}
              />
            )}
            {kind === "mods" && (
              <ModsPanel table={table} current={current} disabled={disabled} onPick={onPick} />
            )}
            {kind === "tapdance" && (
              <div className="legacy-view">
                <TapDancePicker
                  keycodes={group("tapdance")}
                  summaries={info.tapDances ?? []}
                  disabled={disabled}
                  current={current}
                  onPick={(c) => onPick(c)}
                />
              </div>
            )}
            {kind === "macro" && (
              <KeyGrid
                table={table}
                keycodes={group("macro")}
                current={current}
                disabled={disabled}
                onPick={(c) => onPick(c)}
              />
            )}
            {kind === "all" && (
              <div className="legacy-view">
                <KeycodePicker
                  info={info}
                  table={table}
                  disabled={disabled}
                  current={current}
                  onPick={(c) => onPick(c, { fillInner: true })}
                  hint="Select a key on the keyboard first."
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-kumo-line pt-4">
        <KeySearch
          table={table}
          label="Replace with any key"
          disabled={disabled}
          onPick={(c) => onPick(c)}
          recent={recent}
          slashShortcut
        />
      </div>
    </aside>
  );
}

function targetName(targets: readonly NonNullable<Selection>[], layer: string): string {
  if (targets.length > 1) return `${targets.length} keys selected · ${layer}`;
  const t = targets[0];
  if (t.kind === "encoder") return `Encoder ${t.index} ${t.direction === 0 ? "↺" : "↻"} · ${layer}`;
  return `Key at row ${t.row}, column ${t.col} · ${layer}`;
}

function capText(table: KeycodeTable, code: number): string {
  if (code === KC_NO) return "";
  const l = table.label(code);
  return l.inner !== null ? `${l.text}\n${l.inner}` : l.text || table.serialize(code);
}

function KeyGrid({
  table,
  keycodes,
  current,
  disabled,
  onPick,
}: {
  table: KeycodeTable;
  keycodes: readonly { qmk_id: string; label: string; value: number; tooltip?: string }[];
  current: number | null;
  disabled: boolean;
  onPick: (code: number) => void;
}) {
  const seen = new Set<string>();
  const unique = keycodes.filter((kc) => !seen.has(kc.qmk_id) && seen.add(kc.qmk_id));
  return (
    <div className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1 overflow-y-auto pr-1">
      {unique.map((kc) => (
        <button
          key={kc.qmk_id}
          type="button"
          disabled={disabled}
          aria-pressed={kc.value === current}
          title={kc.tooltip ? `${kc.qmk_id}: ${kc.tooltip}` : kc.qmk_id}
          onClick={() => onPick(kc.value)}
          className={
            "min-h-11 cursor-pointer rounded-md border px-1 text-xs leading-tight whitespace-pre-line disabled:cursor-default disabled:opacity-50 " +
            (kc.value === current
              ? "border-accent bg-accent-tint"
              : "border-kumo-line bg-kumo-base hover:border-accent") +
            (table.display(kc).overridden ? " text-accent-link" : "")
          }
        >
          {table.display(kc).text || " "}
        </button>
      ))}
    </div>
  );
}

function LayerPanel({
  keyboard,
  current,
  disabled,
  layerName,
  info,
  onPick,
}: {
  keyboard: Keyboard;
  current: number | null;
  disabled: boolean;
  layerName: (l: number) => string;
  info: PickerInfo;
  onPick: (code: number) => void;
}) {
  const table = keyboard.keycodes;
  const lk = current === null ? null : layerKeyOf(table, keyboard.layers, current);
  const held = lk && (lk.action === "LT" || lk.action === "MO") ? lk.layer : null;
  // The tap key: LT's own, or the key itself when it is a plain key about to become a layer key.
  const tap =
    lk?.action === "LT"
      ? lk.tap || null
      : !lk && current !== null && table.isBasic(current) && current > 1
        ? current
        : null;

  const build = (layer: number, tapKey: number | null) =>
    tapKey !== null && layer < 16
      ? table.parse(`LT(${layer}, ${table.serialize(tapKey)})`)
      : table.parse(`MO(${layer})`);

  const layerKeys = table.groups().find((g) => g.id === "layers")?.keycodes ?? [];

  return (
    <>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">When held</legend>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: keyboard.layers }, (_, l) => (
            <button
              key={l}
              type="button"
              disabled={disabled}
              aria-pressed={held === l}
              aria-label={`Hold for layer ${l}: ${layerName(l)}`}
              onClick={() => onPick(build(l, tap))}
              className={
                "min-h-9 cursor-pointer rounded-lg border px-3 py-1 text-sm disabled:cursor-default disabled:opacity-50 " +
                (held === l
                  ? "border-accent bg-accent-tint font-semibold"
                  : "border-kumo-line hover:bg-kumo-tint")
              }
            >
              {layerName(l)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">When tapped</legend>
        <p className="m-0 text-sm">
          {tap !== null ? (
            <>
              Sends <strong>{keyText(table, tap)}</strong>.{" "}
            </>
          ) : (
            "Nothing: the key only works when held. "
          )}
          {held === null && <span className="text-kumo-subtle">Choose a layer above first.</span>}
        </p>
        {held !== null && (
          <>
            {held >= 16 ? (
              <p className="m-0 text-sm text-kumo-subtle">A tap key needs a layer from 0 to 15.</p>
            ) : (
              <KeySearch
                table={table}
                label="Tap key"
                basicOnly
                disabled={disabled}
                placeholder="Type a key: space, esc, a…"
                onPick={(c) => onPick(build(held, c))}
              />
            )}
            {tap !== null && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(build(held, null))}
                className="self-start text-sm text-accent-link underline"
              >
                Remove the tap key
              </button>
            )}
          </>
        )}
      </fieldset>

      <details className="rounded-lg border border-kumo-line px-3 py-2 [&_.layer-builder]:mt-2">
        <summary className="cursor-pointer text-sm">
          Other layer behaviours: toggle, switch to, one-shot…
        </summary>
        <div className="legacy-view">
          <LayerKeyBuilder
            table={table}
            keycodes={layerKeys}
            info={info}
            disabled={disabled}
            current={current}
            onPick={onPick}
          />
        </div>
      </details>
    </>
  );
}

function ModsPanel({
  table,
  current,
  disabled,
  onPick,
}: {
  table: KeycodeTable;
  current: number | null;
  disabled: boolean;
  onPick: (code: number) => void;
}) {
  const mods = current !== null && isModsKey(current) ? (current >> 8) & 0x1f : 0;
  const key = current === null ? 0 : isModsKey(current) || table.isBasic(current) ? current & 0xff : 0;
  const make = (m: number, k: number) => (m & 0xf ? ((m & 0x1f) << 8) | k : k);

  return (
    <>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">Modifiers held with the key</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MODS.map((m) => (
            <label key={m.name} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                disabled={disabled}
                checked={(mods & m.bit) !== 0}
                onChange={(e) => onPick(make(e.target.checked ? mods | m.bit : mods & ~m.bit, key))}
              />
              {m.name}
            </label>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-kumo-subtle">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            disabled={disabled || (mods & 0xf) === 0}
            checked={(mods & RIGHT) !== 0}
            onChange={(e) => onPick(make(e.target.checked ? mods | RIGHT : mods & ~RIGHT, key))}
          />
          Right-hand modifiers
        </label>
      </fieldset>
      <p className="m-0 text-sm">
        Key: <strong>{key ? keyText(table, key) : "none yet"}</strong>
      </p>
      <KeySearch
        table={table}
        label="Key"
        basicOnly
        disabled={disabled}
        placeholder="Type a key: c, v, tab…"
        onPick={(c) => onPick(make(mods, c))}
      />
    </>
  );
}
