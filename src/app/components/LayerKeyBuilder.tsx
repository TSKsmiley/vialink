// SPDX-License-Identifier: GPL-2.0-or-later
// The Layers tab of the keycode picker as two steps: what the key does, then
// which layer. vial-gui shows the same keycodes as one flat grid (MO(0), MO(1),
// ..., TO(3), LT0(kc), ...); the keycodes and values here are the same ones,
// from KeycodeTable's "layers" group, only laid out differently.

import { useState } from "react";
import type { Keycode, KeycodeTable } from "../../core/keycodes/table.ts";

interface LayerAction {
  /** Keycode id prefix: MO for MO(1), LT for LT1(kc). */
  kind: string;
  title: string;
  description: string;
}

const ACTIONS: readonly LayerAction[] = [
  { kind: "MO", title: "Hold", description: "The layer is on while the key is held." },
  { kind: "TG", title: "Toggle", description: "Tap to turn the layer on, tap again to turn it off." },
  {
    kind: "TO",
    title: "Switch to",
    description: "Turns the layer on and every other layer off, except the default layer.",
  },
  {
    kind: "LT",
    title: "Hold, or tap for a key",
    description: "The layer while held, a key of your choice when tapped (layers 0-15).",
  },
  {
    kind: "TT",
    title: "Tap-toggle",
    description: "Works like Hold; tapping it a few times in a row toggles the layer on.",
  },
  { kind: "OSL", title: "One-shot", description: "The layer is on for the next key press only." },
  {
    kind: "DF",
    title: "Set default",
    description: "Makes the layer the base layer until the keyboard restarts.",
  },
  {
    kind: "PDF",
    title: "Set default (saved)",
    description: "Makes the layer the base layer and remembers it across restarts.",
  },
];

const LT_RE = /^LT(\d+)\(kc\)$/;
const LAYER_RE = /^([A-Z]+)\((\d+)\)$/;

/** The layer keycodes of each action, indexed by layer. */
function byAction(keycodes: readonly Keycode[]): Map<string, Map<number, Keycode>> {
  const out = new Map<string, Map<number, Keycode>>();
  for (const kc of keycodes) {
    const lt = LT_RE.exec(kc.qmk_id);
    const m = lt ? ["", "LT", lt[1]] : LAYER_RE.exec(kc.qmk_id);
    if (!m) continue;
    const layers = out.get(m[1]) ?? new Map<number, Keycode>();
    layers.set(Number(m[2]), kc);
    out.set(m[1], layers);
  }
  return out;
}

interface Props {
  table: KeycodeTable;
  /** The "layers" group's keycodes, as the picker got them. */
  keycodes: readonly Keycode[];
  /** Names of the layers, when the board has them (layer-names extension). */
  layerNames?: readonly string[];
  disabled: boolean;
  current: number | null;
  onPick: (code: number) => void;
}

export function LayerKeyBuilder({ table, keycodes, layerNames, disabled, current, onPick }: Props) {
  const actions = byAction(keycodes);
  const available = ACTIONS.filter((a) => actions.has(a.kind));
  const others = keycodes.filter((kc) => !LT_RE.test(kc.qmk_id) && !LAYER_RE.test(kc.qmk_id));

  // The action and layer of the selected key, when it is one of these keycodes.
  let currentKind: string | null = null;
  let currentLayer: number | null = null;
  if (current !== null) {
    for (const [kind, layers] of actions) {
      for (const [layer, kc] of layers) {
        const matches = kc.masked ? (current & 0xff00) === kc.value : current === kc.value;
        if (matches) {
          currentKind = kind;
          currentLayer = layer;
        }
      }
    }
  }

  const [chosen, setChosen] = useState<string | null>(null);
  // A newly selected key that is already a layer key shows its own action;
  // otherwise the last chosen action stays, to assign several keys alike.
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    if (currentKind !== null) setChosen(null);
  }
  const kind = chosen ?? currentKind ?? available[0]?.kind ?? null;
  const action = available.find((a) => a.kind === kind) ?? null;
  const layers = kind ? [...(actions.get(kind) ?? new Map<number, Keycode>()).entries()] : [];

  const pickLayer = (kc: Keycode) => {
    // Moving an LT key to another layer keeps its tap key.
    if (kc.masked && current !== null && table.isMasked(current) && currentKind === "LT") {
      onPick(kc.value | (current & 0xff));
    } else {
      onPick(kc.value);
    }
  };

  return (
    <div className="layer-builder">
      <fieldset className="layer-actions">
        <legend>1. What should the key do?</legend>
        {available.map((a) => (
          <label key={a.kind} className={`layer-action${a.kind === kind ? " active" : ""}`}>
            <input
              type="radio"
              name="layer-action"
              value={a.kind}
              checked={a.kind === kind}
              onChange={() => setChosen(a.kind)}
            />
            <span className="layer-action-title">{a.title}</span>
            <span className="layer-action-desc">{a.description}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="layer-targets">
        <legend>2. Which layer?</legend>
        <div className="layer-target-list">
          {layers.map(([layer, kc]) => {
            const name = layerNames?.[layer]?.trim();
            const isCurrent = kind === currentKind && layer === currentLayer;
            return (
              <button
                key={layer}
                type="button"
                className={`layer-target${isCurrent ? " current" : ""}`}
                disabled={disabled}
                aria-pressed={isCurrent}
                aria-label={`${action?.title ?? kind}: layer ${layer}${name ? ` (${name})` : ""}`}
                title={kc.tooltip ? `${kc.qmk_id}: ${kc.tooltip}` : kc.qmk_id}
                onClick={() => pickLayer(kc)}
              >
                <span className="layer-target-number">{layer}</span>
                {name ? <span className="layer-target-name">{name}</span> : null}
              </button>
            );
          })}
        </div>
        {kind === "LT" && (
          <p className="hint">After choosing the layer, pick the key to send on tap from the Basic tab.</p>
        )}
      </fieldset>

      {others.length > 0 && (
        <div className="layer-others">
          <span className="hint">Other:</span>
          {others.map((kc) => (
            <button
              key={kc.qmk_id}
              type="button"
              className="keycode"
              disabled={disabled}
              title={kc.tooltip ? `${kc.qmk_id}: ${kc.tooltip}` : kc.qmk_id}
              onClick={() => onPick(kc.value)}
            >
              {kc.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
