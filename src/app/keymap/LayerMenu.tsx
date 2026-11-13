// SPDX-License-Identifier: GPL-2.0-or-later
// The ⋯ menu of a layer card (design board 5), also opened by right-clicking
// the card. Its entries are the running extensions' layer commands
// (extensions/commands.ts); layer sharing's are copy, paste, duplicate, swap,
// share text and clear. Every entry that writes is one undo step.

import { DotsThreeIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { LayerCommand, LayerCommandEnv } from "../extensions/commands.ts";
import { DropdownMenu } from "../ui/index.ts";

interface Props {
  layer: number;
  title: string;
  /** The running extensions' layer commands, each with the shortcut it keeps. */
  commands: readonly { command: LayerCommand; shortcut: string | null }[];
  env: LayerCommandEnv;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Screen point to open at (right-click); null places it under the ⋯ button. */
  at?: { x: number; y: number } | null;
}

export function LayerMenu({ layer, title, commands, env, open, onOpenChange, at = null }: Props) {
  const items: ReactNode[] = [];
  let section: string | undefined;
  for (const { command, shortcut } of commands) {
    if (items.length > 0 && command.section !== section) {
      items.push(<DropdownMenu.Separator key={`sep-${command.id}`} />);
    }
    section = command.section;
    const label = typeof command.title === "function" ? command.title(layer) : command.title;
    const enabled = command.enabled?.(layer, env) ?? true;
    const choices = command.choices?.(layer, env);
    items.push(
      choices ? (
        <DropdownMenu.Sub key={command.id}>
          <DropdownMenu.SubTrigger disabled={!enabled}>{label}</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            {choices.map((c) => (
              <DropdownMenu.Item key={c.value} onClick={() => command.run(layer, env, c.value)}>
                {c.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      ) : (
        <DropdownMenu.Item
          key={command.id}
          disabled={!enabled}
          variant={command.danger ? "danger" : undefined}
          onClick={() => command.run(layer, env)}
        >
          {label}
          {shortcut && <DropdownMenu.Shortcut>{shortcut}</DropdownMenu.Shortcut>}
        </DropdownMenu.Item>
      ),
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            aria-label={`Menu for ${title}`}
            className="relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
          >
            <DotsThreeIcon size={18} weight="bold" />
          </button>
        }
      />
      <DropdownMenu.Content
        {...(at && {
          // A zero-size virtual element at the pointer, like a native context menu.
          anchor: {
            getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }),
          },
          side: "bottom" as const,
          align: "start" as const,
          sideOffset: 2,
        })}
      >
        {items}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
