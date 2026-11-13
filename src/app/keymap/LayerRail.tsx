// SPDX-License-Identifier: GPL-2.0-or-later
// The layer rail of the keymap (design board 1): one card per layer with its
// name, how many keys it sets and how it is reached. Holding Alt over a card
// peeks at that layer without leaving the current one. With the layer names
// extension, a pen after the name edits it in place.
//
// Layers are fixed in firmware, so there is no "add": empty layers are hidden
// except the first, shown as a dashed ghost card. Opening the ghost starts
// naming it; once it has a name or a key it is an ordinary card and the next
// empty layer becomes the ghost. Undoing that write turns it back into the ghost.

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { keyCount, reachSummary } from "../../core/layerInfo.ts";
import { LAYER_NAME_LEN } from "../../core/protocol/constants.ts";
import { errorMessage } from "../hooks.ts";
import type { LayerCommand, LayerCommandEnv, LayerMark } from "../extensions/commands.ts";
import { LayerMenu } from "./LayerMenu.tsx";

export interface LayerRailProps {
  keyboard: Keyboard;
  layer: number;
  onLayer: (layer: number) => void;
  /** Layer to show while Alt is held over a card; null to stop peeking. */
  onPeek: (layer: number | null) => void;
  layerName: (layer: number) => string | null;
  /** Writes a layer name (one undo step); absent when the keyboard has no layer names. */
  rename?: (layer: number, name: string) => Promise<void>;
  onError: (message: string) => void;
  /** What layer commands can do; drag-and-drop swaps too. Absent when layer sharing is off. */
  menu?: LayerCommandEnv;
  /** The running extensions' layer commands for the ⋯ menu. */
  commands?: readonly { command: LayerCommand; shortcut: string | null }[];
  /** Extensions' marks on a layer card (decorations). */
  marks?: (layer: number) => LayerMark[];
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
  rename,
  onError,
  menu,
  commands = [],
  marks,
  copied,
  onClearCopied,
  pasteTarget,
}: LayerRailProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  // Where a right-click opened the menu; null when it was opened from the ⋯ button.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);

  const layers = Array.from({ length: keyboard.layers }, (_, l) => {
    const keys = keyCount(keyboard, l);
    const reach = reachSummary(keyboard, l);
    const name = layerName(l);
    return {
      l,
      keys,
      reach,
      name,
      empty: l > 0 && keys === 0 && !name && reach === "not reached",
    };
  });
  const used = layers.filter((x) => !x.empty).length;
  const ghost = layers.find((x) => x.empty)?.l;
  // The current layer stays visible even when empty (e.g. after an undo).
  const shown = layers.filter((x) => !x.empty || x.l === ghost || x.l === layer);

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
        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5 xl:flex xl:flex-col"
      >
        {shown.map(({ l, keys, reach, name, empty }) => {
          const current = l === layer;
          const title = name || `Layer ${l}`;
          const detail = empty
            ? rename
              ? "Empty · open it to name it"
              : "Empty · assign a key to use it"
            : `${keys} ${keys === 1 ? "key" : "keys"} · ${reach}`;
          return (
            <div
              key={l}
              className={
                "group relative rounded-lg border px-3 py-2.5 " +
                (dropOn === l
                  ? "border-dashed border-accent bg-accent-tint"
                  : current
                    ? "border-accent bg-accent-tint " + (empty ? "border-dashed" : "")
                    : empty
                      ? "border-dashed border-kumo-line text-kumo-subtle hover:bg-kumo-tint"
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
                if (menu && Number.isInteger(from) && from !== l) menu.swap(from, l);
              }}
              onContextMenu={(e) => {
                if (!menu) return;
                e.preventDefault();
                setMenuAt({ x: e.clientX, y: e.clientY });
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
                {editing === l && rename ? (
                  <RenameField
                    layer={l}
                    initial={name ?? ""}
                    save={(n) => rename(l, n)}
                    onDone={() => setEditing(null)}
                    onError={onError}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="flex w-full min-w-0 items-center gap-2">
                      {/* The tab's ::before stretches over the whole card, so a click anywhere selects it. */}
                      <button
                        role="tab"
                        aria-selected={current}
                        aria-label={`${l}: ${title}`}
                        aria-description={detail}
                        onClick={() => {
                          onLayer(l);
                          // Opening the ghost starts naming it; Escape leaves it empty.
                          if (empty && rename) setEditing(l);
                        }}
                        className="flex min-w-0 cursor-pointer items-center gap-2 text-left before:absolute before:inset-0 before:rounded-lg before:content-['']"
                      >
                        <span className="text-xs text-kumo-subtle tabular-nums">{l}</span>
                        <span className={"truncate " + (current ? "font-semibold" : "")}>{title}</span>
                      </button>
                      {rename && (
                        <button
                          type="button"
                          aria-label={`Rename ${title}`}
                          title="Rename"
                          onClick={() => setEditing(l)}
                          className={
                            "relative grid size-6 shrink-0 cursor-pointer place-items-center rounded text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default focus-visible:opacity-100 " +
                            (current ? "" : "opacity-0 group-hover:opacity-100")
                          }
                        >
                          <PencilSimpleIcon aria-hidden="true" size={14} />
                        </button>
                      )}
                    </span>
                    <span
                      aria-hidden="true"
                      className={"text-xs " + (current ? "text-accent-link" : "text-kumo-subtle")}
                    >
                      {pasteTarget === l ? (
                        <strong className="text-accent-link">Pasting here · </strong>
                      ) : null}
                      {detail}
                    </span>
                    {marks?.(l).map((m, i) => (
                      <span key={i} title={m.title} className="text-xs text-kumo-subtle">
                        {m.text}
                      </span>
                    ))}
                  </div>
                )}
                {menu && commands.length > 0 && (
                  <LayerMenu
                    layer={l}
                    title={title}
                    commands={commands}
                    env={menu}
                    open={menuFor === l}
                    at={menuFor === l ? menuAt : null}
                    onOpenChange={(o) => {
                      if (o && menuFor !== l) setMenuAt(null);
                      setMenuFor(o ? l : null);
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="m-0 px-0.5 text-xs leading-relaxed text-kumo-subtle hidden xl:block">
        Hold <kbd className="rounded border border-kumo-line px-1 font-mono text-[11px]">Alt</kbd> over a
        layer to peek at it. Transparent keys show the layer below, dimmed. Drag a card onto another to swap
        them; right-click a card for its menu.
      </p>
    </section>
  );
}

/** The layer name as a text box in place of the title. Enter or leaving the box saves; Escape cancels. */
function RenameField({
  layer,
  initial,
  save,
  onDone,
  onError,
}: {
  layer: number;
  initial: string;
  save: (name: string) => Promise<void>;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const bytes = new TextEncoder().encode(value.trim()).length;
  const tooLong = bytes > LAYER_NAME_LEN;

  const submit = async () => {
    if (busy) return;
    if (tooLong || value.trim() === initial) return onDone();
    setBusy(true);
    try {
      await save(value.trim());
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <form
      className="relative flex min-w-0 flex-1 flex-col gap-0.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label={`Name for layer ${layer}`}
        value={value}
        placeholder={`Layer ${layer}`}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        className="w-full min-w-0 rounded border border-accent bg-kumo-base px-1.5 py-0.5 text-[15px] font-semibold outline-none"
      />
      <span className={"text-xs " + (tooLong ? "text-kumo-danger" : "text-kumo-subtle")}>
        {tooLong ? `Too long: ${bytes} of ${LAYER_NAME_LEN} bytes` : "Enter to save · Esc to cancel"}
      </span>
    </form>
  );
}
