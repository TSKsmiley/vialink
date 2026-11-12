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
import { LayerMenu, type LayerMenuActions } from "./LayerMenu.tsx";

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
  /** Layer menu entries (copy, paste, duplicate, swap, clear); drag-and-drop swaps too. Absent when layer sharing is off. */
  menu?: LayerMenuActions;
  /** What is copied, shown above the cards; null when nothing is. */
  copied: { name: string; keys: number; encoders: number } | null;
  onClearCopied: () => void;
  /** The layer a paste preview targets, marked "pasting here". */
  pasteTarget: number | null;
}

const DRAG_TYPE = "application/x-vialink-layer";

export function LayerRail({
  keyboard,
  layer,
  onLayer,
  onPeek,
  layerName,
  actions,
  onError,
  menu,
  copied,
  onClearCopied,
  pasteTarget,
}: LayerRailProps) {
  const [unfold, setUnfold] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const nameOf = (l: number) => layerName(l) || `Layer ${l}`;

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
      {copied && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-accent px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Copied <strong>{copied.name}</strong>{" "}
            <span className="text-kumo-subtle">
              ({copied.keys} {copied.keys === 1 ? "key" : "keys"}
              {copied.encoders > 0
                ? `, ${copied.encoders} encoder ${copied.encoders === 1 ? "turn" : "turns"}`
                : ""}
              )
            </span>
          </span>
          <button
            type="button"
            aria-label="Clear copied layer"
            onClick={onClearCopied}
            className="cursor-pointer rounded px-1 text-kumo-subtle hover:text-kumo-default"
          >
            ✕
          </button>
        </div>
      )}
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
                (dropOn === l
                  ? "border-dashed border-accent bg-accent-tint"
                  : current
                    ? "border-accent bg-accent-tint"
                    : "border-kumo-line bg-kumo-base hover:bg-kumo-tint")
              }
              draggable={!!menu}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, String(l));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setDropOn(l);
              }}
              onDragLeave={() => setDropOn((d) => (d === l ? null : d))}
              onDrop={(e) => {
                setDropOn(null);
                const from = Number(e.dataTransfer.getData(DRAG_TYPE));
                if (menu && Number.isInteger(from) && from !== l) menu.onSwap(from, l);
              }}
              onContextMenu={(e) => {
                if (!menu) return;
                e.preventDefault();
                setMenuFor(l);
              }}
              onMouseEnter={(e) => {
                setHovered(l);
                if (e.altKey && !current) onPeek(l);
              }}
              onMouseMove={(e) => {
                if (e.altKey && !current) onPeek(l);
                else if (!e.altKey) onPeek(null);
              }}
            >
              <div className="flex items-start gap-1">
                <button
                  role="tab"
                  aria-selected={current}
                  aria-label={`${l}: ${title}`}
                  aria-description={detail}
                  onClick={() => onLayer(l)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-xs text-kumo-subtle tabular-nums">{l}</span>
                    <span className={"truncate " + (current ? "font-semibold" : "")}>{title}</span>
                  </span>
                  <span className={"text-xs " + (current ? "text-accent-link" : "text-kumo-subtle")}>
                    {pasteTarget === l ? <strong className="text-accent-link">Pasting here · </strong> : null}
                    {detail}
                  </span>
                </button>
                {menu && (
                  <LayerMenu
                    layer={l}
                    title={title}
                    layerCount={keyboard.layers}
                    layerName={nameOf}
                    open={menuFor === l}
                    onOpenChange={(o) => setMenuFor(o ? l : null)}
                    {...menu}
                  />
                )}
              </div>
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
        layer to peek at it. Transparent keys show the layer below, dimmed. Drag a card onto another to swap
        them; right-click a card for its menu.
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
