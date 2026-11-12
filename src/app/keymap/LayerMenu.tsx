// SPDX-License-Identifier: GPL-2.0-or-later
// The ⋯ menu of a layer card (design board 5), also opened by right-clicking
// the card: copy, paste, duplicate, swap and clear. Every entry that writes is
// one undo step.

import { DotsThreeIcon } from "@phosphor-icons/react";
import { DropdownMenu } from "../ui/index.ts";

export interface LayerMenuActions {
  onCopy(layer: number): void;
  /** Opens the paste preview onto this layer; absent when nothing is copied. */
  onPaste?(layer: number): void;
  onDuplicate(layer: number): void;
  onSwap(layer: number, other: number): void;
  onClear(layer: number): void;
  onCopyText(layer: number): void;
  onPasteText(): void;
  /** Whether an empty layer exists to duplicate into. */
  canDuplicate: boolean;
}

interface Props extends LayerMenuActions {
  layer: number;
  title: string;
  layerCount: number;
  layerName: (l: number) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LayerMenu({
  layer,
  title,
  layerCount,
  layerName,
  open,
  onOpenChange,
  onCopy,
  onPaste,
  onDuplicate,
  onSwap,
  onClear,
  onCopyText,
  onPasteText,
  canDuplicate,
}: Props) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            aria-label={`Menu for ${title}`}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
          >
            <DotsThreeIcon size={18} weight="bold" />
          </button>
        }
      />
      <DropdownMenu.Content>
        <DropdownMenu.Item onClick={() => onCopy(layer)}>
          Copy layer
          <DropdownMenu.Shortcut>Ctrl+C</DropdownMenu.Shortcut>
        </DropdownMenu.Item>
        <DropdownMenu.Item disabled={!onPaste} onClick={() => onPaste?.(layer)}>
          Paste onto this layer…
          <DropdownMenu.Shortcut>Ctrl+V</DropdownMenu.Shortcut>
        </DropdownMenu.Item>
        <DropdownMenu.Item disabled={!canDuplicate} onClick={() => onDuplicate(layer)}>
          Duplicate to empty layer
        </DropdownMenu.Item>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>Swap with…</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            {Array.from({ length: layerCount }, (_, l) => l)
              .filter((l) => l !== layer)
              .map((l) => (
                <DropdownMenu.Item key={l} onClick={() => onSwap(layer, l)}>
                  {l} · {layerName(l)}
                </DropdownMenu.Item>
              ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onClick={() => onCopyText(layer)}>
          Copy layer as text
          <DropdownMenu.Shortcut>Ctrl+Shift+C</DropdownMenu.Shortcut>
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={onPasteText}>Paste layer from text…</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="danger" onClick={() => onClear(layer)}>
          Clear layer ({layer === 0 ? "all empty" : "all transparent"})
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
