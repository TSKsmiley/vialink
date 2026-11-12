// SPDX-License-Identifier: GPL-2.0-or-later
// Tabbed keycode picker, grouped like vial-gui's tabbed_keycodes.py, with a
// search box and an "Any" entry for keycode expressions typed by hand.

import { useMemo, useState } from "react";
import type { Keycode, KeycodeTable } from "../../core/keycodes/table.ts";
import { LayerKeyBuilder } from "./LayerKeyBuilder.tsx";
import { TapDancePicker } from "./TapDancePicker.tsx";

interface Props {
  table: KeycodeTable;
  disabled: boolean;
  /** Current keycode of the selected key, to show what an assignment replaces. */
  current: number | null;
  onPick: (code: number) => void;
  /** What the board can tell the picker beyond keycodes (see pickerInfoOf). */
  info?: PickerInfo;
}

export interface PickerInfo {
  /** Layer names, when the board has the layer-names extension. */
  layerNames?: readonly string[];
  /** Layers with at least one key or encoder that is not KC_NO or KC_TRNS. */
  usedLayers?: ReadonlySet<number>;
  /** Per tap dance: a short summary of what it does, or null when it is not set up. */
  tapDances?: readonly (string | null)[];
}

export function KeycodePicker({ table, disabled, current, onPick, info }: Props) {
  const groups = useMemo(() => table.groups(), [table]);
  const [tab, setTab] = useState(groups[0]?.id ?? "basic");
  const [query, setQuery] = useState("");
  const [anyText, setAnyText] = useState("");
  const [anyError, setAnyError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown: Keycode[] = useMemo(() => {
    if (!q) return groups.find((g) => g.id === tab)?.keycodes ?? [];
    const seen = new Set<string>();
    return groups
      .flatMap((g) => g.keycodes)
      .filter((kc) => {
        if (seen.has(kc.qmk_id)) return false;
        const hay = [kc.qmk_id, kc.label.replace(/\n/g, " "), kc.tooltip ?? "", ...(kc.alias ?? [])]
          .join(" ")
          .toLowerCase();
        const hit = hay.includes(q);
        if (hit) seen.add(kc.qmk_id);
        return hit;
      });
  }, [groups, tab, q]);

  const submitAny = () => {
    try {
      const code = table.parse(anyText.trim());
      setAnyError(null);
      onPick(code);
    } catch (err) {
      setAnyError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="picker" aria-label="Keycodes">
      <div className="picker-head">
        <div className="tabs" role="tablist">
          {groups.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={!q && tab === g.id}
              className={!q && tab === g.id ? "active" : ""}
              onClick={() => {
                setTab(g.id);
                setQuery("");
              }}
            >
              {g.title}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search keycodes"
          aria-label="Search keycodes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {disabled && <p className="hint">Select a key or encoder direction to assign a keycode.</p>}
      {!disabled && current !== null && (
        <p className="hint">
          Selected key: <code>{table.serialize(current)}</code>
          {table.isMasked(current) && " — picking a basic keycode replaces its inner key."}
        </p>
      )}

      {!q && tab === "layers" ? (
        <LayerKeyBuilder
          table={table}
          keycodes={groups.find((g) => g.id === "layers")?.keycodes ?? []}
          info={info}
          disabled={disabled}
          current={current}
          onPick={(code) => {
            onPick(code);
            // LT(layer, kc): the tap key comes next, from the Basic tab.
            if (table.isMasked(code) && (current === null || !table.isMasked(current))) setTab("basic");
          }}
        />
      ) : !q && tab === "tapdance" && info?.tapDances ? (
        <TapDancePicker
          keycodes={groups.find((g) => g.id === "tapdance")?.keycodes ?? []}
          summaries={info.tapDances}
          disabled={disabled}
          current={current}
          onPick={onPick}
        />
      ) : (
        <div className="keycode-grid">
          {shown.map((kc) => (
            <button
              key={kc.qmk_id}
              className="keycode"
              disabled={disabled}
              title={kc.tooltip ? `${kc.qmk_id}: ${kc.tooltip}` : kc.qmk_id}
              onClick={() => onPick(kc.value)}
            >
              {kc.label === "" ? " " : kc.label}
            </button>
          ))}
          {shown.length === 0 && <p className="hint">No keycodes match “{query}”.</p>}
        </div>
      )}

      <form
        className="any-key"
        onSubmit={(e) => {
          e.preventDefault();
          submitAny();
        }}
      >
        <label htmlFor="any-keycode">Any</label>
        <input
          id="any-keycode"
          placeholder="e.g. LT(1, KC_SPC), LCTL(KC_C), 0x7c00"
          value={anyText}
          onChange={(e) => {
            setAnyText(e.target.value);
            setAnyError(null);
          }}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || anyText.trim() === ""}>
          Assign
        </button>
        {anyError && (
          <span className="error" role="alert">
            {anyError}
          </span>
        )}
      </form>
    </section>
  );
}
