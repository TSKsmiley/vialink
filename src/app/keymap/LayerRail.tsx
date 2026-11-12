// SPDX-License-Identifier: GPL-2.0-or-later
// The layer rail of the keymap (design board 1): one card per layer with its
// name, how many keys it sets and how it is reached. Empty layers fold into
// one row. Holding Alt over a card peeks at that layer without leaving the
// current one. Extensions add per-layer actions (e.g. Rename) to the current
// card through AppExtension.LayerActions.

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ComponentType } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { keyCount, reachSummary } from "../../core/layerInfo.ts";
import type { LayerActionProps } from "../extensions/registry.tsx";

export interface LayerRailProps {
  keyboard: Keyboard;
  layer: number;
  onLayer: (layer: number) => void;
  /** Layer to show while Alt is held over a card; null to stop peeking. */
  onPeek: (layer: number | null) => void;
  layerName: (layer: number) => string | null;
  /** Per-layer controls from extensions, shown on the current card. */
  actions: { id: string; Component: ComponentType<LayerActionProps> }[];
  onError: (message: string) => void;
}

export function LayerRail({ keyboard, layer, onLayer, onPeek, layerName, actions, onError }: LayerRailProps) {
  const [unfold, setUnfold] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const layers = Array.from({ length: keyboard.layers }, (_, l) => {
    const keys = keyCount(keyboard, l);
    const reach = reachSummary(keyboard, l);
    const name = layerName(l);
    return { l, keys, reach, name, empty: l > 0 && keys === 0 && !name && reach === "not reached" };
  });
  const used = layers.filter((x) => !x.empty).length;
  const folded = unfold ? [] : layers.filter((x) => x.empty && x.l !== layer);
  const shown = layers.filter((x) => !folded.includes(x));

  // Pressing Alt while over a card peeks; letting go returns.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt" && hovered !== null && hovered !== layer) {
        e.preventDefault();
        onPeek(hovered);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") onPeek(null);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [hovered, layer, onPeek]);

  return (
    <section
      aria-label="Layers"
      className="flex min-w-0 flex-col gap-1.5"
      onMouseLeave={() => {
        setHovered(null);
        onPeek(null);
      }}
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className="m-0 text-[15px] font-semibold">Layers</h2>
        <span className="text-xs text-kumo-subtle">
          {used} of {keyboard.layers} used
        </span>
      </div>
      <div
        role="tablist"
        aria-label="Layer"
        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5 min-[1600px]:flex min-[1600px]:flex-col"
      >
        {shown.map(({ l, keys, reach, name }) => {
          const current = l === layer;
          const title = name || `Layer ${l}`;
          const detail = `${keys} ${keys === 1 ? "key" : "keys"} · ${reach}`;
          return (
            <div
              key={l}
              className={
                "rounded-lg border px-3 py-2.5 " +
                (current
                  ? "border-accent bg-accent-tint"
                  : "border-kumo-line bg-kumo-base hover:bg-kumo-tint")
              }
              onMouseEnter={(e) => {
                setHovered(l);
                if (e.altKey && !current) onPeek(l);
              }}
              onMouseMove={(e) => {
                if (e.altKey && !current) onPeek(l);
                else if (!e.altKey) onPeek(null);
              }}
            >
              <button
                role="tab"
                aria-selected={current}
                aria-label={`${l}: ${title}`}
                aria-description={detail}
                onClick={() => onLayer(l)}
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 text-left"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-xs text-kumo-subtle tabular-nums">{l}</span>
                  <span className={current ? "font-semibold" : ""}>{title}</span>
                </span>
                <span className={"text-xs " + (current ? "text-accent-link" : "text-kumo-subtle")}>
                  {detail}
                </span>
              </button>
              {current && actions.length > 0 && (
                <div className="legacy-view mt-2 flex flex-wrap items-center gap-2 text-sm [&_button]:text-sm">
                  <PencilSimpleIcon aria-hidden="true" className="text-kumo-subtle" size={14} />
                  {actions.map(({ id, Component }) => (
                    <Component key={id} keyboard={keyboard} layer={l} onError={onError} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {folded.length > 0 && (
        <button
          className="min-h-9 cursor-pointer rounded-lg border border-dashed border-kumo-line px-3 py-2 text-left text-sm text-kumo-subtle hover:bg-kumo-tint"
          onClick={() => setUnfold(true)}
        >
          {folded.length} empty {folded.length === 1 ? "layer" : "layers"} (
          {rangeText(folded.map((x) => x.l))})
        </button>
      )}
      <p className="m-0 px-0.5 text-xs leading-relaxed text-kumo-subtle hidden min-[1600px]:block">
        Hold <kbd className="rounded border border-kumo-line px-1 font-mono text-[11px]">Alt</kbd> over a
        layer to peek at it. Transparent keys show the layer below, dimmed.
      </p>
    </section>
  );
}

/** [4, 5, 6, 7] → "4–7"; [2, 5] → "2, 5". */
function rangeText(ns: number[]): string {
  const parts: string[] = [];
  let start = ns[0];
  for (let i = 1; i <= ns.length; i++) {
    if (ns[i] !== ns[i - 1] + 1) {
      const end = ns[i - 1];
      parts.push(start === end ? `${start}` : `${start}–${end}`);
      start = ns[i];
    }
  }
  return parts.join(", ");
}
