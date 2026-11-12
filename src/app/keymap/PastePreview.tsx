// SPDX-License-Identifier: GPL-2.0-or-later
// Paste preview (design board 5): the target layer with the keys the paste
// would change outlined, and beside it the paste options. Nothing is written
// until Paste; the paste is one undo step. Renders two grid children
// (board and inspector areas of KeymapView).

import { useId, useMemo, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import {
  applyLayerWrites,
  planPaste,
  snapshotCounts,
  type LayerSnapshot,
  type PasteMode,
} from "../../core/layers.ts";
import { KeyboardView } from "../components/KeyboardView.tsx";
import { errorMessage } from "../hooks.ts";
import { Button } from "../ui/index.ts";
import { keyText } from "./KeySearch.tsx";

export interface PasteSource {
  snapshot: LayerSnapshot;
  /** "Nav", "2 keys from Nav", "Nav from a shared text". */
  name: string;
}

interface Props {
  keyboard: Keyboard;
  source: PasteSource;
  target: number;
  onTarget: (layer: number) => void;
  layerName: (layer: number) => string;
  onClose: (pastedOnto: number | null) => void;
  onError: (message: string) => void;
}

export function PastePreview({ keyboard, source, target, onTarget, layerName, onClose, onError }: Props) {
  const ids = useId();
  const counts = snapshotCounts(source.snapshot);
  const someKeys = source.snapshot.keys.size < keyboard.matrixPositions.length;
  const [mode, setMode] = useState<PasteMode>(someKeys ? "replace" : "overlay");
  const hasEncoders = source.snapshot.encoders.size > 0 && keyboard.encoderIndices.length > 0;
  const [encoders, setEncoders] = useState(true);
  const [busy, setBusy] = useState(false);
  const table = keyboard.keycodes;

  const plan = useMemo(
    () => planPaste(keyboard, source.snapshot, target, mode, encoders),
    // keyboard.version: re-plan when the board changes underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyboard, keyboard.version, source, target, mode, encoders],
  );
  const changed = new Map(
    plan.writes.flatMap((w) => (w.kind === "key" ? [[`${w.row},${w.col}`, w] as const] : [])),
  );
  const keyWrites = changed.size;
  const encoderWrites = plan.writes.length - keyWrites;
  const targetName = layerName(target);

  const modes: { id: PasteMode; label: string; hint: string }[] = [
    {
      id: "replace",
      label: someKeys ? "Replace these keys" : "Replace the whole layer",
      hint: someKeys
        ? "Each copied key replaces the key in its spot, transparent ones too."
        : `${targetName} becomes an exact copy of ${source.name}.`,
    },
    {
      id: "overlay",
      label: `Only where ${source.name} has a key`,
      hint: `Transparent keys in ${source.name} leave ${targetName}'s key in place.`,
    },
    {
      id: "fill",
      label: `Only fill ${targetName}'s empty keys`,
      hint: `Keys already set on ${targetName} are never touched.`,
    },
  ];

  const paste = async () => {
    setBusy(true);
    try {
      await applyLayerWrites(keyboard, target, plan.writes, `Paste ${source.name} onto ${targetName}`);
      onClose(target);
    } catch (err) {
      onError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <section aria-label="Paste preview" className="flex min-w-0 flex-col gap-3 [grid-area:board]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="m-0 text-xl font-semibold">
            Paste {source.name} onto {targetName}
          </h1>
          <span className="text-sm text-kumo-subtle">Preview: nothing is written until you press Paste</span>
        </div>
        <div className="board-wrap rounded-xl border border-kumo-line bg-kumo-elevated p-2 md:p-3">
          <KeyboardView
            keyboard={keyboard}
            layer={target}
            label={`Preview of ${targetName}`}
            codeAt={(r, c) => changed.get(`${r},${c}`)?.to}
            highlight={(r, c) => (changed.has(`${r},${c}`) ? "changed" : null)}
            note={(r, c) => {
              const w = changed.get(`${r},${c}`);
              return w ? `was ${table.serialize(w.from)}` : null;
            }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-kumo-subtle">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] border-2 border-accent bg-accent-tint" />
            Changes (hover a key to see what it was)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] border border-kumo-line" />
            Stays as it is on {targetName}
          </span>
        </div>
      </section>

      <aside
        aria-label="Paste options"
        className="flex min-w-0 flex-col gap-4 rounded-xl border border-kumo-line bg-kumo-elevated p-5 [grid-area:insp] lg:sticky lg:top-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-target`} className="text-sm font-semibold">
            From {source.name}, onto
          </label>
          <select
            id={`${ids}-target`}
            value={target}
            onChange={(e) => onTarget(Number(e.target.value))}
            className="min-h-9 rounded-lg border border-kumo-line bg-kumo-control px-2.5"
          >
            {Array.from({ length: keyboard.layers }, (_, l) => (
              <option key={l} value={l}>
                {l} · {layerName(l)}
              </option>
            ))}
          </select>
          <span className="text-xs text-kumo-subtle">
            Copied: {counts.keys} {counts.keys === 1 ? "key" : "keys"}
            {counts.encoders > 0
              ? `, ${counts.encoders} encoder ${counts.encoders === 1 ? "turn" : "turns"}`
              : ""}
          </span>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">How to paste</legend>
          {modes.map((m) => (
            <label
              key={m.id}
              className={
                "flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 " +
                (mode === m.id ? "border-accent bg-accent-tint" : "border-kumo-line")
              }
            >
              <input
                type="radio"
                name={`${ids}-mode`}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className={mode === m.id ? "font-semibold" : "font-medium"}>{m.label}</span>
                <span
                  className={
                    "text-xs leading-snug " + (mode === m.id ? "text-accent-link" : "text-kumo-subtle")
                  }
                >
                  {m.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {hasEncoders && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={encoders}
              onChange={(e) => setEncoders(e.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              Include encoders{" "}
              <span className="text-kumo-subtle">
                ({keyboard.encoderIndices.length} {keyboard.encoderIndices.length === 1 ? "knob" : "knobs"})
              </span>
            </span>
          </label>
        )}

        {plan.selfReferences.length > 0 && (
          <div
            role="note"
            className="rounded-lg border border-dashed border-kumo-line px-3 py-2 text-sm text-kumo-subtle"
          >
            {plan.selfReferences.length === 1 ? "One key" : `${plan.selfReferences.length} keys`} in{" "}
            {source.name} {plan.selfReferences.length === 1 ? "reaches" : "reach"} {targetName} (
            {plan.selfReferences.map((s) => keyText(table, s.code)).join(", ")}). On {targetName}{" "}
            {plan.selfReferences.length === 1 ? "that key" : "those keys"} would hold the layer it is on, so{" "}
            {plan.selfReferences.length === 1 ? "it is" : "they are"} left as{" "}
            {plan.selfReferences.length === 1 ? "it is" : "they are"}.
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-kumo-line pt-4">
          <span className="text-sm">
            <strong>
              {keyWrites} {keyWrites === 1 ? "key" : "keys"}
            </strong>{" "}
            change
            {encoderWrites > 0
              ? ` (and ${encoderWrites} encoder ${encoderWrites === 1 ? "turn" : "turns"})`
              : ""}
            , {plan.unchanged} stay. You can undo this.
          </span>
          <div className="flex justify-end gap-2">
            <Button onClick={() => onClose(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void paste()}
              loading={busy}
              disabled={plan.writes.length === 0}
            >
              {plan.writes.length === 0
                ? "Nothing to paste"
                : `Paste ${keyWrites + encoderWrites} ${keyWrites + encoderWrites === 1 ? "change" : "changes"}`}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
